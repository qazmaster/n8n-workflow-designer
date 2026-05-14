import type { NodeJSON } from '@n8n/workflow-sdk';

export interface CredentialPlaceholder {
  id: string;
  name: string;
}

export interface NodeRegistryEntry {
  type: string;
  label: string;
  credentialTypes?: string[];
  requiredParameters?: string[];
  communityPackage?: string;
  installHint?: string;
}

export interface RegistryValidationIssue {
  code: string;
  message: string;
  recommendation: string;
}

export const CREDENTIAL_PLACEHOLDERS: Record<string, Record<string, CredentialPlaceholder>> = {
  'n8n-nodes-base.bitrix24': {
    bitrix24OAuth2Api: { id: 'BITRIX24_CREDENTIAL_ID', name: 'Bitrix24 account' },
  },
  'n8n-nodes-base.microsoftTeams': {
    microsoftTeamsOAuth2Api: { id: 'MICROSOFT_TEAMS_CREDENTIAL_ID', name: 'Microsoft Teams account' },
  },
  'n8n-nodes-base.microsoftOutlook': {
    microsoftOutlookOAuth2Api: { id: 'MICROSOFT_OUTLOOK_CREDENTIAL_ID', name: 'Microsoft Outlook account' },
  },
  'n8n-nodes-base.microsoftOutlookTrigger': {
    microsoftOutlookOAuth2Api: { id: 'MICROSOFT_OUTLOOK_CREDENTIAL_ID', name: 'Microsoft Outlook account' },
  },
  'n8n-nodes-base.telegram': {
    telegramApi: { id: 'TELEGRAM_CREDENTIAL_ID', name: 'Telegram Bot' },
  },
  'n8n-nodes-base.telegramTrigger': {
    telegramApi: { id: 'TELEGRAM_CREDENTIAL_ID', name: 'Telegram Bot' },
  },
  'n8n-nodes-base.googleSheets': {
    googleSheetsOAuth2Api: { id: 'GOOGLE_SHEETS_CREDENTIAL_ID', name: 'Google Sheets account' },
  },
  'n8n-nodes-base.googleDrive': {
    googleDriveOAuth2Api: { id: 'GOOGLE_DRIVE_CREDENTIAL_ID', name: 'Google Drive account' },
  },
  '@n8n/n8n-nodes-langchain.lmChatOpenAi': {
    openAiApi: { id: 'OPENAI_CREDENTIAL_ID', name: 'OpenAI account' },
  },
  '@n8n/n8n-nodes-langchain.vectorStoreQdrant': {
    qdrantApi: { id: 'QDRANT_CREDENTIAL_ID', name: 'Qdrant account' },
  },
};

export const NODE_REGISTRY: Record<string, NodeRegistryEntry> = {
  'n8n-nodes-base.manualTrigger': {
    type: 'n8n-nodes-base.manualTrigger',
    label: 'Manual Trigger',
  },
  'n8n-nodes-base.webhook': {
    type: 'n8n-nodes-base.webhook',
    label: 'Webhook',
  },
  'n8n-nodes-base.httpRequest': {
    type: 'n8n-nodes-base.httpRequest',
    label: 'HTTP Request',
    requiredParameters: ['url'],
  },
  'n8n-nodes-base.bitrix24': {
    type: 'n8n-nodes-base.bitrix24',
    label: 'Bitrix24',
    credentialTypes: ['bitrix24OAuth2Api'],
  },
  'n8n-nodes-base.microsoftTeams': {
    type: 'n8n-nodes-base.microsoftTeams',
    label: 'Microsoft Teams',
    credentialTypes: ['microsoftTeamsOAuth2Api'],
  },
  'n8n-nodes-base.microsoftOutlook': {
    type: 'n8n-nodes-base.microsoftOutlook',
    label: 'Microsoft Outlook',
    credentialTypes: ['microsoftOutlookOAuth2Api'],
  },
  'n8n-nodes-base.microsoftOutlookTrigger': {
    type: 'n8n-nodes-base.microsoftOutlookTrigger',
    label: 'Microsoft Outlook Trigger',
    credentialTypes: ['microsoftOutlookOAuth2Api'],
  },
  'n8n-nodes-base.telegram': {
    type: 'n8n-nodes-base.telegram',
    label: 'Telegram',
    credentialTypes: ['telegramApi'],
  },
  'n8n-nodes-base.telegramTrigger': {
    type: 'n8n-nodes-base.telegramTrigger',
    label: 'Telegram Trigger',
    credentialTypes: ['telegramApi'],
  },
  'n8n-nodes-base.googleSheets': {
    type: 'n8n-nodes-base.googleSheets',
    label: 'Google Sheets',
    credentialTypes: ['googleSheetsOAuth2Api'],
  },
  'n8n-nodes-base.googleDrive': {
    type: 'n8n-nodes-base.googleDrive',
    label: 'Google Drive',
    credentialTypes: ['googleDriveOAuth2Api'],
  },
  '@n8n/n8n-nodes-langchain.lmChatOpenAi': {
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    label: 'OpenAI Chat Model',
    credentialTypes: ['openAiApi'],
  },
  '@n8n/n8n-nodes-langchain.vectorStoreQdrant': {
    type: '@n8n/n8n-nodes-langchain.vectorStoreQdrant',
    label: 'Qdrant Vector Store',
    credentialTypes: ['qdrantApi'],
    communityPackage: 'built-in LangChain Qdrant node or installed Qdrant community package',
    installHint: 'Verify Qdrant node support and credentials in the target n8n instance.',
  },
  'n8n-nodes-docxtemplater.docxtemplater': {
    type: 'n8n-nodes-docxtemplater.docxtemplater',
    label: 'DOCX Templater',
    communityPackage: 'n8n-nodes-docxtemplater',
    installHint: 'Install n8n-nodes-docxtemplater before import/deploy.',
  },
};

export function credentialRequirementsFor(type: string): string[] {
  return NODE_REGISTRY[type]?.credentialTypes || [];
}

export function communityPackageFor(type: string): string | undefined {
  return NODE_REGISTRY[type]?.communityPackage;
}

export function communityInstallHintFor(type: string): string | undefined {
  return NODE_REGISTRY[type]?.installHint;
}

export function validateNodeAgainstRegistry(node: Partial<NodeJSON>): RegistryValidationIssue[] {
  if (!node.type) {
    return [];
  }

  const entry = NODE_REGISTRY[node.type];
  if (!entry) {
    return [{
      code: 'unknown-node-type',
      message: `${node.type} is not in the local node registry.`,
      recommendation: 'Confirm the node exists in the target n8n instance or extend the registry before relying on schema checks.',
    }];
  }

  return (entry.requiredParameters || [])
    .filter((key) => !hasParameter(node.parameters, key))
    .map((key) => ({
      code: 'missing-required-parameter',
      message: `${entry.label} is missing required parameter: ${key}.`,
      recommendation: `Set parameters.${key} before deployment.`,
    }));
}

function hasParameter(parameters: NodeJSON['parameters'] | undefined, key: string): boolean {
  return typeof parameters === 'object' && parameters !== null && key in parameters;
}
