import type { CoachExpectationsContent, PlatformExpectationsContent } from "@/lib/expectations/types";

/**
 * Starter wording. Every word is meant to be edited: it is a starting point a
 * coach makes their own, not something TalentYak asserts on their behalf. It
 * names no credentials, promises no results, and asks for no health details —
 * those belong in the private health intake, never in this document.
 */
export const COACH_STARTER: CoachExpectationsContent = {
  provides:
    "Coaching built around the goals you share with me. Exactly what's included — programme, check-ins, calls and messaging — is listed in your plan details below, and those details are what you're paying for.",
  meeting_approach:
    "We work mainly through the TalentYak app: your plan, your check-ins and our messages all live there, so nothing gets lost.",
  typical_duration: "",
  appointments:
    "If your plan includes calls, we agree times together in our messages. I'm based in Nepal, so we'll pick times that work in both our time zones.",
  messaging_availability:
    "I read and reply to messages during my working hours, which are shown in our conversation.",
  response_expectation:
    "I usually reply within one working day. If I'm away, I'll say so in advance.",
  changes:
    "If something about your coaching needs to change — your goals, your schedule, or how we work — tell me in our messages and we'll talk it through. Anything that would change your price or what your plan includes goes through TalentYak, never through this document.",
  client_part: [
    "Tell me about your goals, and privately about any injuries or limitations that affect your training.",
    "Give me honest feedback about what is and isn't working.",
    "Log the progress we agree to track, so I can adjust your plan.",
    "Complete the check-ins we agree on.",
    "Let me know as early as you can if you can't make a session or need to pause.",
  ],
  coach_part: [
    "Plan your coaching around your goals and circumstances.",
    "Review your check-ins and progress, and adjust your plan when it's needed.",
    "Reply to your messages within the time I've described above.",
    "Keep what you share with me private.",
    "Tell you in advance about any change to my availability.",
  ],
};

/**
 * Draft wording for the TalentYak section, for the founder to edit and publish.
 * It states the support ROUTE (the Support page in the account) rather than an
 * address, and links only to pages that exist. It is not legal policy text.
 */
export const PLATFORM_STARTER: PlatformExpectationsContent = {
  conduct:
    "Treat each other with respect. Harassment, discrimination, threats and inappropriate messages are not allowed, from either side. Keep coaching conversations and payments inside TalentYak.",
  privacy:
    "What you share with your coach stays between you, your current coach and, only where needed to help you, TalentYak support. Share health details only through the private places in the app made for them — never in public. Your coach can't see your card details; TalentYak doesn't store them either.",
  support:
    "If something isn't right — with your coaching, a payment, or anything else — open a case from Support in your TalentYak account. You can also ask to change coach there.",
  policy_links: ["/legal/terms", "/legal/privacy", "/account/support"],
};
