type WebhookPayload = Record<string, unknown> & {
  accountAddresses?: string[];
  webhookURL?: string;
  transactionTypes?: string[];
  webhookType?: string;
  authHeader?: string;
  txnStatus?: string;
};

export async function appendHeliusWebhookAddresses(params: {
  apiKey: string;
  webhookId: string;
  addresses: string[];
}): Promise<{ updated: boolean; total: number }> {
  const endpoint = `https://api.helius.xyz/v0/webhooks/${params.webhookId}?api-key=${params.apiKey}`;
  const current = await fetch(endpoint);
  if (!current.ok) {
    throw new Error(`helius_get_failed:${current.status}`);
  }

  const data = (await current.json()) as WebhookPayload;
  const existing = Array.isArray(data.accountAddresses) ? data.accountAddresses : null;
  if (!existing) {
    throw new Error("helius_invalid_response");
  }

  const merged = uniqueStrings([...existing, ...params.addresses]);
  if (merged.length === existing.length) {
    return { updated: false, total: merged.length };
  }

  const payload = buildUpdatePayload(data, merged);
  const updated = await fetch(endpoint, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!updated.ok) {
    throw new Error(`helius_update_failed:${updated.status}`);
  }

  return { updated: true, total: merged.length };
}

function buildUpdatePayload(
  current: WebhookPayload,
  accountAddresses: string[],
): WebhookPayload {
  const webhookURL =
    current.webhookURL ?? (current as { webhook_url?: string }).webhook_url;
  const transactionTypes =
    current.transactionTypes ??
    (current as { transaction_types?: string[] }).transaction_types;
  const webhookType =
    current.webhookType ?? (current as { webhook_type?: string }).webhook_type;
  const authHeader =
    current.authHeader ?? (current as { auth_header?: string }).auth_header;
  const txnStatus = current.txnStatus ?? (current as { txn_status?: string }).txn_status;

  if (!webhookURL || !transactionTypes || !webhookType) {
    throw new Error("helius_missing_fields");
  }

  const payload: WebhookPayload = {
    webhookURL,
    transactionTypes,
    webhookType,
    accountAddresses,
  };
  if (authHeader) payload.authHeader = authHeader;
  if (txnStatus) payload.txnStatus = txnStatus;
  return payload;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
