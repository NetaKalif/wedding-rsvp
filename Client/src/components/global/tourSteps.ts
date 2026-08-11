import type { StepOptions } from "shepherd.js";

type TourStep = StepOptions & { icon?: string };

// Helper to navigate and wait for element to be available
const navigateAndContinue = (path: string, maxWait = 5000) => {
  return async () => {
    const tour = (window as any).shepherdTour;
    // Hide the current step right away — its anchor is about to unmount, and a
    // visible step with no anchor gets re-floated to the corner of the screen
    tour?.hide();
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));

    const steps = tour?.steps ?? [];
    const nextStep = steps[steps.indexOf(tour?.getCurrentStep()) + 1];
    const nextSelector = nextStep?.options?.attachTo?.element;

    const startedAt = Date.now();
    const showNextWhenReady = () => {
      const anchorReady =
        typeof nextSelector !== "string" || document.querySelector(nextSelector);
      if (anchorReady || Date.now() - startedAt >= maxWait) {
        tour?.next();
      } else {
        setTimeout(showNextWhenReady, 100);
      }
    };
    setTimeout(showNextWhenReady, 100);
  };
};

// Helper to click an element, optionally wait for another element to appear,
// then advance to the next step
const clickAndContinue = (
  clickSelector: string,
  waitForSelector?: string,
  maxWait = 3000
) => {
  return async () => {
    const tour = (window as any).shepherdTour;
    tour?.hide();
    (document.querySelector(clickSelector) as HTMLElement | null)?.click();

    const startedAt = Date.now();
    const showNextWhenReady = () => {
      if (
        !waitForSelector ||
        document.querySelector(waitForSelector) ||
        Date.now() - startedAt >= maxWait
      ) {
        tour?.next();
      } else {
        setTimeout(showNextWhenReady, 100);
      }
    };
    setTimeout(showNextWhenReady, 100);
  };
};

// Expand the first budget category (if collapsed) so the add-vendor button is
// visible, then advance
const expandCategoryAndContinue = (maxWait = 3000) => {
  return async () => {
    const tour = (window as any).shepherdTour;
    tour?.hide();
    if (!document.querySelector('[data-tour="add-vendor-btn"]')) {
      (
        document.querySelector('[data-tour="category-header"]') as HTMLElement | null
      )?.click();
    }

    const startedAt = Date.now();
    const showNextWhenReady = () => {
      if (
        document.querySelector('[data-tour="add-vendor-btn"]') ||
        Date.now() - startedAt >= maxWait
      ) {
        tour?.next();
      } else {
        setTimeout(showNextWhenReady, 100);
      }
    };
    setTimeout(showNextWhenReady, 100);
  };
};

// Go back one step, first navigating to the page the previous step lives on
// (when it isn't the current page) and waiting for its anchor to render
const backAndNavigate = (path?: string, maxWait = 5000) => {
  return () => {
    const tour = (window as any).shepherdTour;
    if (!path || window.location.pathname === path) {
      tour?.back();
      return;
    }
    tour?.hide();
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));

    const steps = tour?.steps ?? [];
    const prevStep = steps[steps.indexOf(tour?.getCurrentStep()) - 1];
    const prevSelector = prevStep?.options?.attachTo?.element;

    const startedAt = Date.now();
    const showPrevWhenReady = () => {
      const anchorReady =
        typeof prevSelector !== "string" || document.querySelector(prevSelector);
      if (anchorReady || Date.now() - startedAt >= maxWait) {
        tour?.back();
      } else {
        setTimeout(showPrevWhenReady, 100);
      }
    };
    setTimeout(showPrevWhenReady, 100);
  };
};

const createBackButton = (path?: string) => ({
  action: backAndNavigate(path),
  text: "הקודם",
  classes: "btn btn-secondary",
});

const createButton = (text: string, isPrimary = true, action?: () => void) => ({
  action: action || (() => {
    const tour = (window as any).shepherdTour;
    if (text === "סיום סיור") tour?.complete();
    else if (text === "דלג") tour?.cancel();
    else tour?.next();
  }),
  text,
  classes: isPrimary ? "btn btn-primary" : "btn btn-secondary",
});

const getStandardButtons = (hasBack = true, backPath?: string) => {
  const buttons = [];
  if (hasBack) {
    buttons.push(createBackButton(backPath));
  }
  buttons.push(createButton("המשך"));
  return buttons;
};

// First step of each page's tour section — lets the tour button start from
// the section of the page the user is currently on instead of the beginning
export const TOUR_PAGE_START_STEPS: Record<string, string> = {
  "/tasks": "tasks-overview",
  "/budget": "budget-overview",
  "/rsvp": "guest-counts",
  "/gifts": "gift-stats",
};

export const getTourSteps = (): TourStep[] => [
  {
    id: "welcome",
    title: "!ברוכים הבאים",
    text: "בואו נעשה סיור שיעזור לכם להתחיל לתכנן את החתונה שלכם. נעבור על כל התכונות צעד אחרי צעד.",
    buttons: [
      createButton("דלג", false),
      createButton("התחל סיור"),
    ],
    icon: "👋",
  },

  {
    id: "partner-setup",
    title: "הוסף בן/בת זוג",
    text: "לחץ על תפריט הפרופיל שלך ובחר 'הזמנת/חיבור בן זוג' כדי לקשר חשבונות.",
    attachTo: {
      element: '[data-tour="user-menu"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "💑",
  },

  {
    id: "dashboard-overview",
    title: "ספירה לאחור לחתונה",
    text: "כאן תוכל/י לראות כמה זמן נשאר עד היום הגדול, יחד עם התאריך, השעה והמיקום של החתונה שלך.",
    attachTo: {
      element: '[data-tour="wedding-countdown"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "⏳",
  },

  // TASKS
  {
    id: "tasks-intro",
    title: "משימות התכנון",
    text: "עכשיו בואו נלך לחלק המשימות כדי לנהל את רשימת בדיקת התכנון שלך.",
    attachTo: {
      element: '[data-tour="nav-tasks"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      createButton("עבור למשימות", true, navigateAndContinue("/tasks")),
    ],
    icon: "✅",
  },

  {
    id: "tasks-overview",
    title: "משימות מוכנות מראש",
    text: "כל משתמש מקבל רשימת משימות ברירת מחדל, מחולקת לתקופות זמן — מ'רק התארסנו' ועד יום החתונה עצמו.",
    attachTo: {
      element: '[data-tour="first-task-group"]',
      on: "bottom",
    },
    buttons: getStandardButtons(true, "/"),
    icon: "📋",
  },

  {
    id: "edit-task",
    title: "עריכת משימה",
    text: "בעזרת כפתור העריכה אפשר לשנות כל משימה — את התיאור שלה, מי אחראי/ת עליה (כלה, חתן או שניכם) ולאיזו תקופה היא שייכת.",
    attachTo: {
      element: '[data-tour="edit-task-btn"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      createButton(
        "המשך",
        true,
        clickAndContinue('[data-tour="add-task-btn"]', '[data-tour="add-task-form"]')
      ),
    ],
    icon: "✏️",
  },

  {
    id: "add-task",
    title: "הוספת משימה חדשה",
    text: "לחיצה על כפתור 'משימה' פותחת את הטופס הזה. מלאו כותרת, בחרו תקופה, עדיפות ואחראי/ת — ולחצו 'שמירה'.",
    attachTo: {
      element: '[data-tour="add-task-form"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      // Toggle the form closed again before moving on to the budget section
      createButton("המשך", true, clickAndContinue('[data-tour="add-task-btn"]')),
    ],
    icon: "➕",
  },

  // BUDGET
  {
    id: "budget-intro",
    title: "תקציב וספקים",
    text: "עכשיו בואו נלך לתקציב כדי להתחיל לנהל את תקציב החתונה שלך.",
    buttons: [
      createBackButton(),
      createButton("עבור לתקציב", true, navigateAndContinue("/budget")),
    ],
    icon: "💰",
  },

  {
    id: "budget-overview",
    title: "לוח בקרה של תקציב",
    text: "זה מרכז התקציב שלך. כאן תוכל/י לראות את הסטטיסטיקות של התקציב הכולל.",
    attachTo: {
      element: '[data-tour="budget-stats"]',
      on: "bottom",
    },
    buttons: getStandardButtons(true, "/tasks"),
    icon: "📈",
  },

  {
    id: "total-budget",
    title: "תקציב כולל",
    text: "זה התקציב הכולל שהגדרתם לחתונה. לחיצה על אייקון העיפרון מאפשרת לעדכן אותו בכל שלב, בהתאם לצרכים שלכם.",
    attachTo: {
      element: '[data-tour="total-budget"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🐷",
  },

  {
    id: "planned-expenses",
    title: "התחיבויות",
    text: "הסכום הכולל שסגרתם מול ספקים: כל ספק שהזמנתם נספר כאן במחיר המלא שסיכמתם איתו — גם אם עוד לא שילמתם לו מקדמה (ספק בסטטוס 'יצרנו קשר' עדיין לא נספר). מהסכום הזה מחושבים גם התקציב הפנוי וגם העלות לאורח.",
    attachTo: {
      element: '[data-tour="planned-expenses"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📝",
  },

  {
    id: "remaining-budget",
    title: "תקציב פנוי",
    text: "כמה נשאר לכם לסגירת ספקים נוספים: התקציב הכולל פחות ההתחיבויות. שימו לב — החישוב לפי מה שהתחייבתם, לא לפי מה ששולם בפועל. אם המספר אדום, ההתחיבויות כבר עברו את התקציב.",
    attachTo: {
      element: '[data-tour="remaining-budget"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🪙",
  },

  {
    id: "paid-total",
    title: "שולמו",
    text: "סך התשלומים שרשמתם בפועל לספקים — מקדמות ותשלומים. ההפרש בין ההתחיבויות למה ששולם הוא מה שעוד תצטרכו לשלם לספקים שסגרתם.",
    attachTo: {
      element: '[data-tour="paid-total"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "💸",
  },

  {
    id: "guest-count",
    title: "מספר אורחים",
    text: "הזינו את מספר האורחים הצפוי (בעזרת אייקון העיפרון). העלות לאורח מחושבת מסך ההתחיבויות שלכם חלקי מספר האורחים.",
    attachTo: {
      element: '[data-tour="guest-count"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "👥",
  },

  {
    id: "add-category",
    title: "קטגוריות תקציב",
    text: "לחץ על 'הוסף קטגוריה' כדי ליצור קטגוריות כמו קיטרינג, צילום וכו'.",
    attachTo: {
      element: '[data-tour="add-category-btn"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      createButton("המשך", true, expandCategoryAndContinue()),
    ],
    icon: "🏷️",
  },

  {
    id: "add-vendor",
    title: "הוספת ספק",
    text: "בתוך כל קטגוריה נמצא כפתור 'הוסף ספק'. משם מוסיפים את הספקים שאתם בודקים או סוגרים — בואו נציץ בטופס.",
    attachTo: {
      element: '[data-tour="add-vendor-btn"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      createButton(
        "המשך",
        true,
        clickAndContinue('[data-tour="add-vendor-btn"]', '[data-tour="vendor-status"]')
      ),
    ],
    icon: "🤝",
  },

  {
    id: "vendor-status",
    title: "סטטוס ספק",
    text: "לכל ספק בוחרים סטטוס: 'יצרנו קשר' — עדיין לא סגרתם איתו (ולכן הוא לא נספר בהתחיבויות), 'הוזמן' — סגרתם, 'שולם חלקית' ו'שולם'. הסטטוס מתעדכן אוטומטית כשתרשמו תשלומים.",
    attachTo: {
      element: '[data-tour="vendor-status"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🚦",
  },

  {
    id: "vendor-files",
    title: "הסכמים וקבצים",
    text: "העלו לכאן את ההסכם והצעת המחיר של כל ספק. בשנה של תכנון מול הרבה ספקים, שווה שכל המסמכים יהיו שמורים במקום אחד — כך תמיד תדעו בדיוק על מה סיכמתם.",
    attachTo: {
      element: '[data-tour="vendor-files"]',
      on: "top",
    },
    buttons: [
      createBackButton(),
      // Close the vendor modal (its cancel button), then continue to the
      // payment step on the first vendor card
      createButton(
        "המשך",
        true,
        clickAndContinue(
          '[data-hook="baseModalLayout-secondary-button"]',
          '[data-tour="add-payment-btn"]'
        )
      ),
    ],
    icon: "📎",
  },

  {
    id: "add-payment",
    title: "רישום תשלום",
    text: "אחרי שהוספתם ספק, לחצו על 'תשלום' כדי לרשום מקדמה או כל סכום אחר ששילמתם לו. התשלומים מצטברים לכרטיס 'שולמו' שראינו למעלה.",
    attachTo: {
      element: '[data-tour="add-payment-btn"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "💳",
  },

  {
    id: "vendor-balance",
    title: "כמה נשאר לשלם",
    text: "בכל ספק תראו את המחיר שסגרתם, כמה כבר שולם — וכמה עוד נותר לשלם לו בעתיד.",
    attachTo: {
      element: '[data-tour="vendor-balance"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🧾",
  },

  // RSVP
  {
    id: "rsvp-intro",
    title: "אישורי הגעה",
    text: "עכשיו בואו נלך לאישורי הגעה. זו התכונה העיקרית של המערכת.",
    buttons: [
      createBackButton(),
      createButton("עבור לאישורי הגעה", true, navigateAndContinue("/rsvp")),
    ],
    icon: "📬",
  },

  {
    id: "guest-counts",
    title: "ספירת אורחים",
    text: "כאן רואים כמה אנשים מוזמנים בסך הכול (כולל בני/בנות זוג וילדים שבכל הזמנה), כמה אנשים אישרו הגעה — וכמה סירבו.",
    attachTo: {
      element: '[data-tour="guest-counts"]',
      on: "bottom",
    },
    buttons: getStandardButtons(true, "/budget"),
    icon: "👥",
  },

  {
    id: "response-rates",
    title: "שיעורי תגובה",
    text: "וכאן הספירה לפי הזמנות: כמה אישרו, כמה עדיין ממתינות לתשובה וכמה סירבו. אחרי שליחת ההזמנות, זה המקום לעקוב אחרי מי שטרם ענה.",
    attachTo: {
      element: '[data-tour="response-rates"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📈",
  },

  {
    id: "add-guests-intro",
    title: "הוספת אורחים",
    text: "מכאן מוסיפים אורחים לרשימה — אחד אחד או בהעלאת קובץ אקסל. בואו נציץ בטופס.",
    attachTo: {
      element: '[data-tour="add-guests-btn"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      createButton(
        "המשך",
        true,
        clickAndContinue('[data-tour="add-guests-btn"]', '[data-tour="manual-guest-form"]')
      ),
    ],
    icon: "👫",
  },

  {
    id: "manual-guest-form",
    title: "הוספה ידנית",
    text: "כך מוסיפים אורח יחיד: שם, טלפון, מי הזמין (כלה/חתן), מעגל (משפחה, חברים מהעבודה...) ומספר האורחים בהזמנה. לאורח בלי טלפון סמנו את התיבה למטה — הוא פשוט לא יקבל הודעות ווטסאפ.",
    attachTo: {
      element: '[data-tour="manual-guest-form"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      // Switch to the file-upload tab before the next step
      createButton(
        "המשך",
        true,
        clickAndContinue(
          '[data-tour="add-guest-tabs"] [role="tab"]:nth-child(2)',
          '[data-tour="excel-upload"]'
        )
      ),
    ],
    icon: "⌨️",
  },

  {
    id: "excel-upload",
    title: "העלאת קובץ אקסל",
    text: "לרשימה גדולה: הורידו את התבנית הריקה, מלאו אותה והעלו — כל האורחים יתווספו בבת אחת. אורחים שלא נקלטו (למשל טלפון שגוי או כפול) יורדו אוטומטית כקובץ עם הסיבה לכל אחד.",
    attachTo: {
      element: '[data-tour="excel-upload"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      // Close the add-guest panel and move on to the guest list
      createButton(
        "המשך",
        true,
        clickAndContinue(
          '[data-hook="sidePanel-header-close-button"]',
          '[data-tour="guests-table"]'
        )
      ),
    ],
    icon: "📊",
  },

  {
    id: "guests-table",
    title: "רשימת האורחים",
    text: "כל שורה היא הזמנה — עם הפרטים, מספר האורחים וסטטוס אישור ההגעה. אפשר לערוך או למחוק כל אורח ישירות מהטבלה.",
    attachTo: {
      element: '[data-tour="guests-table"]',
      on: "top",
    },
    buttons: getStandardButtons(),
    icon: "📋",
  },

  {
    id: "search-filter",
    title: "חיפוש וסינון",
    text: "חפשו אורח לפי שם, או סננו לפי סטטוס (אישר, ממתין, סירב), מי הזמין ומעגל — נוח במיוחד כשרוצים להתמקד במי שעוד לא ענה.",
    attachTo: {
      element: '[data-tour="search-filter"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🔍",
  },

  {
    id: "edit-details",
    title: "עריכת פרטי החתונה",
    text: "כאן עורכים את פרטי החתונה ותמונת ההזמנה, ומגדירים גם את התזכורת האוטומטית לאורחים שאישרו (יום לפני או ביום החתונה, בשעה שתבחרו) והודעת תודה מותאמת אישית שנשלחת יום אחרי.",
    attachTo: {
      element: '[data-tour="edit-details-btn"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📝",
  },

  {
    id: "send-messages-intro",
    title: "שליחת הודעות",
    text: "כ-3 שבועות לפני החתונה, מכאן שולחים לאורחים הזמנות ווטסאפ עם כפתורי אישור הגעה. בואו נראה את האפשרויות.",
    attachTo: {
      element: '[data-tour="send-messages-btn"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      createButton(
        "המשך",
        true,
        clickAndContinue('[data-tour="send-messages-btn"]', '[data-tour="message-types"]')
      ),
    ],
    icon: "💌",
  },

  {
    id: "message-types",
    title: "סוגי הודעות",
    text: "'הזמנה לאישור הגעה' — ההודעה הראשונית עם כפתורי אישור/סירוב. 'שליחה חוזרת לממתינים' — תזכורת שנשלחת רק למי שטרם ענה. אסטרטגיה מומלצת: הזמנה, ואז תזכורת כל כמה ימים לממתינים.",
    attachTo: {
      element: '[data-tour="message-types"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📨",
  },

  {
    id: "select-specific-guests",
    title: "בחירת אורחים לשליחה",
    text: "כברירת מחדל ההודעה נשלחת לכל הקבוצה הרלוונטית. סימון התיבה מאפשר לבחור אורחים ספציפיים — עם חיפוש וסינון לפי מזמין ומעגל.",
    attachTo: {
      element: '[data-tour="select-specific-guests"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "✋",
  },

  {
    id: "whatsapp-preview",
    title: "תצוגה מקדימה",
    text: "כאן רואים בדיוק איך ההודעה תיראה אצל האורחים בווטסאפ — כולל תמונת ההזמנה שלכם.",
    attachTo: {
      element: '[data-tour="whatsapp-preview"]',
      on: "top",
    },
    buttons: [
      createBackButton(),
      // Close the messages panel and continue to the pending-calls button
      createButton(
        "המשך",
        true,
        clickAndContinue(
          '[data-hook="sidePanel-header-close-button"]',
          '[data-tour="call-pending-btn"]'
        )
      ),
    ],
    icon: "👀",
  },

  {
    id: "call-pending",
    title: "שיחות לממתינים",
    text: "אורחים שלא עונים להודעות? בלחיצה אחת המערכת מתקשרת לכל הממתינים — שיחה אוטומטית בעברית שבה הם מאשרים הגעה במקשי הטלפון.",
    attachTo: {
      element: '[data-tour="call-pending-btn"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📞",
  },

  {
    id: "export-rsvp",
    title: "ייצוא נתונים",
    text: "לחיצה על 'ייצוא' מורידה את רשימת האורחים כקובץ אקסל — נוח לשיתוף עם האולם והספקים.",
    attachTo: {
      element: '[data-tour="export-btn"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📥",
  },

  {
    id: "events-tab",
    title: "אירועים נוספים",
    text: "מתכננים גם חינה, מסיבת רווקות/רווקים או קבלת פנים? בלשונית הזו מנהלים אירועים נוספים בנפרד מהחתונה.",
    attachTo: {
      element: '[data-tour="events-tab"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      createButton(
        "המשך",
        true,
        clickAndContinue('[data-tour="events-tab"]', '[data-tour="add-event-btn"]')
      ),
    ],
    icon: "🎉",
  },

  {
    id: "add-event",
    title: "יצירת אירוע",
    text: "צרו אירוע חדש, בחרו אליו אורחים מתוך רשימת החתונה — ושלחו לו הזמנות ותזכורות בנפרד, עם מעקב אישורי הגעה משלו.",
    attachTo: {
      element: '[data-tour="add-event-btn"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      // Switch back to the guests tab before leaving the RSVP page
      createButton("המשך", true, clickAndContinue('[data-tour="guests-tab"]')),
    ],
    icon: "🎪",
  },

  // GIFTS
  {
    id: "gifts-intro",
    title: "מתנות חתונה",
    text: "עכשיו בואו נלך למתנות כדי לעקוב אחר מתנות מהאורחים.",
    buttons: [
      createBackButton(),
      createButton("עבור למתנות", true, navigateAndContinue("/gifts")),
    ],
    icon: "🎁",
  },

  {
    id: "gift-stats",
    title: "סטטיסטיקות מתנות",
    text: "סיכום המתנות שקיבלתם: הסכום הכולל, ממוצע לאורח (לפי מספר האנשים שהגיעו בפועל מכל הזמנה שנתנה מתנה) וכמה אורחים נתנו מתנה.",
    attachTo: {
      element: '[data-tour="gift-stats"]',
      on: "bottom",
    },
    buttons: getStandardButtons(true, "/rsvp"),
    icon: "📊",
  },

  {
    id: "guest-search",
    title: "רישום מתנה",
    text: "חפשו אורח לפי שם. בחירת אורח מציגה את הפרטים שלו ומאפשרת גם לעדכן כמה אנשים הגיעו ממנו בפועל ('מספר מאושרים') — שימושי במיוחד ביום שאחרי.",
    attachTo: {
      element: '[data-tour="guest-search"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🔎",
  },

  {
    id: "gift-form",
    title: "פרטי המתנה",
    text: "בחרו את סוג המתנה — מזומן, צ׳ק, ביט, פייבוקס, העברה בנקאית, BUYME או אחר — הזינו סכום ולחצו 'הוספת מתנה'. לכל אורח נרשמת מתנה אחת, ואפשר לערוך אותה מהטבלה.",
    attachTo: {
      element: '[data-tour="gift-form"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "✍️",
  },

  {
    id: "add-gift-guest",
    title: "אורחים שלא הוזמנו",
    text: "קיבלתם מתנה ממישהו שלא ברשימת המוזמנים? מוסיפים אותו מכאן — בואו נציץ.",
    attachTo: {
      element: '[data-tour="add-gift-guest-btn"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      createButton(
        "המשך",
        true,
        clickAndContinue('[data-tour="add-gift-guest-btn"]', '[data-tour="add-gift-guest-form"]')
      ),
    ],
    icon: "🤷",
  },

  {
    id: "add-gift-guest-form",
    title: "הוספת אורח לא מוזמן",
    text: "ממלאים שם, טלפון (לא חובה) ומי המזמין — והאורח מתווסף לרשימה בלי שיוך לאירוע, כך שאפשר לרשום גם את המתנה שלו.",
    attachTo: {
      element: '[data-tour="add-gift-guest-form"]',
      on: "bottom",
    },
    buttons: [
      createBackButton(),
      // Close the modal (its cancel button) and continue to the table
      createButton(
        "המשך",
        true,
        clickAndContinue(
          '[data-hook="baseModalLayout-secondary-button"]',
          '[data-tour="gifts-table"]'
        )
      ),
    ],
    icon: "📇",
  },

  {
    id: "gifts-table",
    title: "אורחים ומתנות",
    text: "כל האורחים בטבלה אחת: כמה הגיעו מכל הזמנה ואילו מתנות נרשמו. עורכים או מוחקים מתנה עם אייקוני העיפרון והפח, ממיינים לפי שם או סכום, ומחפשים למעלה.",
    attachTo: {
      element: '[data-tour="gifts-table"]',
      on: "top",
    },
    buttons: getStandardButtons(),
    icon: "📋",
  },

  {
    id: "export-gifts",
    title: "ייצוא מתנות",
    text: "לחיצה על 'ייצוא לאקסל' מורידה את כל טבלת האורחים והמתנות — הבסיס המושלם לרשימת מכתבי התודה.",
    attachTo: {
      element: '[data-tour="export-gifts-btn"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📥",
  },

  // Post-Wedding / data export
  {
    id: "data-export",
    title: "הורדת הנתונים שלכם",
    text: "בתפריט המשתמש תמצאו 'הורדת הנתונים שלי' — הורדה בכל רגע של כל המידע שלכם: אורחים ואישורי הגעה, מתנות ותקציב.",
    attachTo: {
      element: '[data-tour="user-menu"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "💾",
  },

  {
    id: "cleanup-flow",
    title: "מה קורה אחרי החתונה?",
    text: "60 יום אחרי החתונה החשבון וכל הנתונים נמחקים לצמיתות. שלושה ימים לפני המחיקה יישלח אליכם מייל אזהרה עם קובץ מלא של כל הנתונים — כך ששום דבר לא הולך לאיבוד.",
    attachTo: {
      element: '[data-tour="user-menu"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🗑️",
  },

  // Final
  {
    id: "tour-complete",
    title: "!בהצלחה",
    text: "מזל טוב! אתה/את כעת יודע/ת כיצד להשתמש במערכת. התחל בבן/בת הזוג, ואז: משימות → תקציב → אישורי הגעה → מתנות.",
    buttons: [
      createBackButton(),
      createButton("סיום סיור"),
    ],
    icon: "✨",
  },
];
