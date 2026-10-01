export const CLASSIFY_SYSTEM_PROMPT = `You decide whether a block of text is a job advertisement.

A job advertisement describes a role someone can apply for: the work, what is
required, who the employer is, or how to apply. Pasted adverts often carry
website clutter around them ("Apply now", "Save job", cookie notices, "Posted 3
days ago") — ignore the clutter and judge the substance.

These are NOT job advertisements: a company profile, a news article, a CV or
resume, an email, a product page, notes, or a list of unrelated text.

Return JSON only:
{
  "bIsJobPost": true or false,
  "sReason": "one short sentence saying why",
  "sLooksLike": "what the text actually is, when it is not a job advertisement, otherwise null"
}`;

export function buildClassifyPrompt(text: string): string {
  return "Is this a job advertisement?\n\n" + text.slice(0, 6000);
}
