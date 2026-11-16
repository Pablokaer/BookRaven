import { apiJson, apiOk } from "./api";

/** Promotional emails (Admin → Emails); the server side is apps/api/src/lib/campaigns.ts. */

export type TemplateId = "missyou" | "comeback" | "continue" | "classics" | "share" | "recap" | "announcement";
export type Hero = "clouds" | "door" | "scholar" | "none";
export type Segment = "all" | "inactive" | "in_progress" | "never_read";
export type Audience = { segment: Segment; days: number };

export type CampaignContent = {
  subject: string;
  preheader: string;
  eyebrow: string;
  headline: string;
  message: string;
  buttonLabel: string;
  buttonPath: string;
  hero: Hero;
};

export type EmailTemplate = { id: TemplateId; name: string; description: string; defaults: CampaignContent; audience: Audience };

export type EmailPreview = { subject: string; preheader: string; html: string; sample: boolean; emptyClassics: boolean };

export type Campaign = {
  id: string;
  template: TemplateId;
  subject: string;
  audience: Audience;
  status: "sending" | "sent" | "interrupted";
  recipients: number;
  sent: number;
  failed: number;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
};

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

export const listTemplates = () => apiJson<{ templates: EmailTemplate[]; mailEnabled: boolean }>("/api/admin/emails/templates");
export const audienceSize = (a: Audience) => apiJson<{ count: number }>("/api/admin/emails/audience", post(a));
export const previewEmail = (template: TemplateId, content: CampaignContent) =>
  apiJson<EmailPreview>("/api/admin/emails/preview", post({ template, content }));
export const sendTestEmail = (template: TemplateId, content: CampaignContent) => apiOk("/api/admin/emails/test", post({ template, content }));
export const sendCampaign = (template: TemplateId, content: CampaignContent, audience: Audience) =>
  apiJson<{ id: string; recipients: number }>("/api/admin/emails/send", post({ template, content, audience }));
export type AccountEmail = { id: string; name: string; description: string; subject: string; preheader: string; html: string };
export const listAccountEmails = () => apiJson<AccountEmail[]>("/api/admin/emails/account");
export const listCampaigns = () => apiJson<Campaign[]>("/api/admin/emails/campaigns");

export const getEmailPreferences = () => apiJson<{ promotional: boolean }>("/api/me/email-preferences");
export const setEmailPreferences = (promotional: boolean) =>
  apiOk("/api/me/email-preferences", { method: "PUT", body: JSON.stringify({ promotional }) });

export const SEGMENT_LABELS: Record<Segment, { label: string; hint: string; usesDays: boolean }> = {
  all: { label: "Everyone", hint: "Every account that hasn't unsubscribed.", usesDays: false },
  inactive: { label: "Away for a while", hint: "Nothing read in the last N days.", usesDays: true },
  in_progress: { label: "Book left halfway", hint: "A book started but not finished, nothing read in N days.", usesDays: true },
  never_read: { label: "Never started reading", hint: "Accounts that have not opened a book yet.", usesDays: false },
};

export const HERO_LABELS: Record<Hero, string> = {
  door: "The raven over the door",
  clouds: "The raven in the clouds",
  scholar: "The reader in his chair",
  none: "No picture",
};
