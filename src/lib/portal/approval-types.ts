/**
 * Shapes shared by the approval card (client) and the pages and helpers
 * that build it (server). Types only.
 */

/** Only what the card renders: the page never hands raw rows to the client. */
export type ApprovalCardData = {
  id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  risk_score: number | null;
  /** Risk flags already translated to plain labels server-side. */
  risk_chips: string[];
  /** Inbox link to the conversation this came from (migration 062), if known. */
  conversation_href?: string | null;
};

/**
 * Labels arrive pre-translated from the server page (strings.ts is
 * server-only, so the dictionary cannot be imported here). Keys mirror
 * the ra.* namespace.
 */
export type ApprovalLabels = {
  actions: Record<string, string>;
  riskHigh: string;
  riskMedium: string;
  proposedLabel: string;
  originalMessage: string;
  editLabel: string;
  rejectLabel: string;
  rejectPlaceholder: string;
  btnApprove: string;
  btnModify: string;
  btnReject: string;
  btnApproveEdited: string;
  btnConfirmReject: string;
  btnCancel: string;
  btnBack: string;
  realtimeHint: string;
  stubHint: string;
  approvedRealtime: string;
  approvedStub: string;
  approvedRealtimeDesc: string;
  approvedStubDesc: string;
  rejected: string;
  rejectedDesc: string;
  alreadyTitle: string;
  alreadyDesc: string;
  sending: string;
  approving: string;
  rejecting: string;
  errorText: string;
  editPiiError: string;
  /** API error code → plain sentence. Unknown codes use errorText. */
  errors: Record<string, string>;
  /** Sensitive-data type code (US_PHONE…) → plain words. */
  piiTypes: Record<string, string>;
  piiOther: string;
  /** "Open conversation" */
  openConversation?: string;
  /** Staff see an approval but cannot decide it: "Only the owner can approve". */
  ownerOnly: string;
  ownerOnlyHint: string;
};
