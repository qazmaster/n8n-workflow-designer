#!/usr/bin/env python3
import os
import json
import sys
import time
import requests

# ---------------------------------------------------------------------------
# Статические правила валидации (используются при оффлайн-режиме или как дополнение)
# ---------------------------------------------------------------------------
STATIC_SCHEMA_RULES = {
    "n8n-nodes-base.if": [
        {
            "min_version": 2.0,
            "description": "IF node v2+ conditions must have object-based operator formatting",
            "validate_func": lambda node, params: check_if_node_v2(node, params)
        }
    ],
    "n8n-nodes-base.filter": [
        {
            "min_version": 2.0,
            "description": "Filter node v2+ conditions must have object-based operator formatting",
            "validate_func": lambda node, params: check_if_node_v2(node, params)
        }
    ],
    "n8n-nodes-base.switch": [
        {
            "min_version": 2.0,
            "description": "Switch node v2+ must use nested rules and object-based operators",
            "validate_func": lambda node, params: check_switch_node_v2(node, params)
        }
    ],
    "n8n-nodes-base.set": [
        {
            "min_version": 3.0,
            "description": "Set node v3+ must use 'fields' array instead of legacy 'values' objects",
            "validate_func": lambda node, params: check_set_node_v3(node, params)
        }
    ]
}

def check_if_node_v2(node, params):
    errors = []
    conditions_obj = params.get("conditions", {})
    conditions_list = conditions_obj.get("conditions", [])
    for idx, cond in enumerate(conditions_list):
        operator = cond.get("operator")
        if operator is None:
            continue
        if isinstance(operator, str):
            errors.append(
                f"Condition at index {idx} uses legacy flat string operator: '{operator}'. "
                f"Expected object: {{'type': '<type>', 'operation': '{operator}'}}."
            )
    return errors

def check_switch_node_v2(node, params):
    errors = []
    rules_obj = params.get("rules", {})
    rules_list = rules_obj.get("rules", [])
    for idx, rule in enumerate(rules_list):
        conditions_list = rule.get("conditions", {}).get("conditions", [])
        for c_idx, cond in enumerate(conditions_list):
            operator = cond.get("operator")
            if operator is None:
                continue
            if isinstance(operator, str):
                errors.append(
                    f"Rule {idx}, condition {c_idx} uses legacy flat string operator: '{operator}'. "
                    f"Expected object: {{'type': '<type>', 'operation': '{operator}'}}."
                )
    return errors

def check_set_node_v3(node, params):
    errors = []
    if "values" in params:
        errors.append(
            "Uses legacy 'values' object structure. Set node v3+ requires 'fields' array."
        )
    return errors

# ---------------------------------------------------------------------------
# Загрузка и кэширование схем из API n8n (как работает n8n-mcp)
# ---------------------------------------------------------------------------
def load_config():
    """Загружает URL и API ключ из config.json или переменных окружения."""
    api_url = os.environ.get("N8N_BASE_URL")
    api_key = os.environ.get("N8N_API_KEY")
    
    # Пытаемся прочитать из config.json в проекте
    for config_path in ["course_materials/test_runner/config.json", "../test_runner/config.json", "config.json"]:
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    conf = json.load(f)
                    if "n8n_api_url" in conf and not api_url:
                        api_url = conf["n8n_api_url"]
                    if "n8n_api_key" in conf and not api_key:
                        api_key = conf["n8n_api_key"]
            except Exception:
                pass
                
    return api_url, api_key

def fetch_dynamic_schemas(api_url, api_key):
    """Делает запрос к n8n API с поддержкой локального кэширования (24 часа)."""
    if not api_url or not api_key:
        return None
        
    cache_dir = os.path.expanduser("~/.cache/n8n")
    cache_path = os.path.join(cache_dir, "node_schemas_cache.json")
    
    # Проверяем наличие свежего кэша (менее 24 часов)
    if os.path.exists(cache_path):
        mtime = os.path.getmtime(cache_path)
        if time.time() - mtime < 86400:  # 24 часа
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    print("[INFO] Loading node schemas from local cache...")
                    return json.load(f)
            except Exception:
                pass

    # Запрашиваем новые данные
    url = f"{api_url.rstrip('/')}/node-types"
    headers = {
        "X-N8N-API-KEY": api_key,
        "Content-Type": "application/json"
    }
    
    try:
        print(f"Connecting to n8n API at {url} to fetch fresh node schemas...")
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            node_types = response.json()
            schema_map = {}
            for nt in node_types:
                name = nt.get("name")
                if name:
                    schema_map[name] = nt
            
            # Сохраняем в кэш
            try:
                os.makedirs(cache_dir, exist_ok=True)
                with open(cache_path, 'w', encoding='utf-8') as f:
                    json.dump(schema_map, f, ensure_ascii=False)
                print("[INFO] Updated local cache with fresh schemas.")
            except Exception as ce:
                print(f"[Warning] Failed to write cache: {ce}")
                
            return schema_map
        else:
            print(f"[Warning] Failed to fetch node-types. HTTP Status: {response.status_code}")
    except Exception as e:
        print(f"[Warning] Failed to connect to n8n instance: {e}")
        
    # Если запрос не удался, пробуем отдать устаревший кэш
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                print("[INFO] Fallback: Loading stale node schemas from local cache.")
                return json.load(f)
        except Exception:
            pass
            
    return None

# ---------------------------------------------------------------------------
# Логика динамического сопоставления параметров со схемой
# ---------------------------------------------------------------------------
def validate_node_dynamically(node, schema):
    """Сверяет параметры ноды со схемой, полученной от API."""
    errors = []
    params = node.get("parameters", {})
    properties = schema.get("properties", [])
    
    prop_map = {p["name"]: p for p in properties}
    
    for param_name, param_value in params.items():
        if isinstance(param_value, str) and param_value.startswith("="):
            continue
            
        prop_def = prop_map.get(param_name)
        if not prop_def:
            errors.append(f"Parameter '{param_name}' is not defined in the schema of node '{node.get('name')}' version {node.get('typeVersion')}.")
            continue
            
        prop_type = prop_def.get("type")
        
        if prop_type == "filter":
            if isinstance(param_value, dict):
                conditions = param_value.get("conditions", [])
                for idx, cond in enumerate(conditions):
                    operator = cond.get("operator")
                    if isinstance(operator, str):
                        errors.append(
                            f"Parameter '{param_name}' uses legacy string operator '{operator}' "
                            f"in condition index {idx}. Schema expects nested operator object."
                        )
                        
        elif prop_type == "fixedCollection":
            if not isinstance(param_value, dict) and not isinstance(param_value, list):
                errors.append(f"Parameter '{param_name}' should be an object or array (fixedCollection), got {type(param_value).__name__}.")
                
    return errors

# ---------------------------------------------------------------------------
# Главная функция валидации воркфлоу
# ---------------------------------------------------------------------------
def validate_workflow(filepath, dynamic_schemas=None):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        return [f"Failed to parse JSON: {e}"]
        
    errors = []
    nodes = data.get("nodes", [])
    
    for node in nodes:
        node_type = node.get("type")
        node_name = node.get("name", "Unknown Node")
        type_version = node.get("typeVersion", 1)
        
        if node_type in STATIC_SCHEMA_RULES:
            rules = STATIC_SCHEMA_RULES[node_type]
            for rule in rules:
                try:
                    version_float = float(type_version)
                except ValueError:
                    version_float = 1.0
                if version_float >= rule["min_version"]:
                    node_errors = rule["validate_func"](node, node.get("parameters", {}))
                    for err in node_errors:
                        errors.append(
                            f"Node '{node_name}' ({node_type} v{type_version}): {err}"
                        )
                        
        if dynamic_schemas and node_type in dynamic_schemas:
            schema = dynamic_schemas[node_type]
            dyn_errors = validate_node_dynamically(node, schema)
            for err in dyn_errors:
                errors.append(f"Dynamic Check -> Node '{node_name}': {err}")
                
    return errors

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 universal_node_validator.py <workflow.json | directory_path>")
        sys.exit(1)
        
    target = sys.argv[1]
    
    api_url, api_key = load_config()
    dynamic_schemas = fetch_dynamic_schemas(api_url, api_key)
    
    if dynamic_schemas:
        print(f"[INFO] Successfully loaded schemas for {len(dynamic_schemas)} node types.")
    else:
        print("[INFO] Offline mode: n8n API not configured or unreachable. Using static rules engine.")
        
    if os.path.isdir(target):
        all_passed = True
        print(f"Scanning directory: {target}...")
        for root, _, files in os.walk(target):
            for file in files:
                if file.endswith(".json"):
                    filepath = os.path.join(root, file)
                    errors = validate_workflow(filepath, dynamic_schemas)
                    if errors:
                        print(f"[FAIL] {filepath}")
                        for err in errors:
                            print(f"  - {err}")
                        all_passed = False
                    else:
                        print(f"[OK] {filepath}")
        if all_passed:
            print("\nValidation successful.")
            sys.exit(0)
        else:
            print("\nValidation failed.")
            sys.exit(1)
    else:
        if not os.path.exists(target):
            print(f"Error: Target path {target} does not exist.")
            sys.exit(1)
        errors = validate_workflow(target, dynamic_schemas)
        if errors:
            print(f"[FAIL] {target}")
            for err in errors:
                print(f"  - {err}")
            sys.exit(1)
        else:
            print(f"[OK] {target} is valid.")
            sys.exit(0)

if __name__ == "__main__":
    main()
