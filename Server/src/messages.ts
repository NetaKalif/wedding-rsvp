export const messagesMap = {
  pending: "אין בעיה, כשתדע/י- אנא שלח/י מספר אורחים",
  approveFollowUp: "איזה כיף! כמה אורחים תהיו? אנא השיבו במספר בלבד",
  // Variant used when the event's ask_invited_count flag is on: states how
  // many guests the invitation was for ("ל-1 אורחים" reads badly, so the
  // single-guest case gets its own phrasing).
  approveFollowUpWithCount: (count: number) =>
    count === 1
      ? "איזה כיף! ההזמנה שלכם היא לאורח אחד, כמה אורחים תגיעו? נא להשיב במספר בלבד"
      : `איזה כיף! ההזמנה שלכם היא ל-${count} אורחים, כמה אורחים תגיעו? נא להשיב במספר בלבד`,
  approved: "תודה רבה, נתראה בקרוב! ניתן לשנות את תשובתך ע״י שליחת מספר אורחים",
  declined:
    "לא נורא, הכל בסדר! אם תתחרט/י, ניתן לשנות את תשובתך ע״י שליחת מספר אורחים",
  unknownResponse: "לא הבנתי את תשובתך, נא להשיב במספר בלבד בין 0 ל10",
  mistake: "סליחה על ההפרעה! נמחקת מהרשימה שלנו",
  thankYou: (message: string, brideName: string, groomName: string) =>
    `אורחים יקרים,
${message ? message : "תודה רבה שהגעתם לחגוג איתנו!"}
${brideName} ו${groomName}`,
};
