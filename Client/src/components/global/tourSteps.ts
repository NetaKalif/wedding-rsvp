import Shepherd from "shepherd.js";
import type { StepOptions } from "shepherd.js";

type TourStep = StepOptions & { icon?: string };

// Helper to navigate and wait for element to be available
const navigateAndContinue = (path: string, delay = 1200) => {
  return async () => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setTimeout(() => {
      const tour = (window as any).shepherdTour;
      tour?.next();
    }, delay);
  };
};

// Helper to open a modal and continue
const openModalAndContinue = (selector: string, delay = 500) => {
  return async () => {
    setTimeout(() => {
      const element = document.querySelector(selector) as HTMLElement;
      if (element) {
        if (element.tagName === 'BUTTON') {
          (element as HTMLButtonElement).click();
        } else {
          element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      }
    }, 100);

    setTimeout(() => {
      // Close modal by pressing Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      const tour = (window as any).shepherdTour;
      tour?.next();
    }, delay);
  };
};

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

const getStandardButtons = (hasBack = true) => {
  const buttons = [];
  if (hasBack) {
    buttons.push({
      action: () => {
        const tour = (window as any).shepherdTour;
        tour?.back();
      },
      text: "הקודם",
      classes: "btn btn-secondary",
    });
  }
  buttons.push(createButton("המשך"));
  return buttons;
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
    id: "partner-intro",
    title: "שיתוף פעולה עם בן/בת הזוג",
    text: "כיוון שאתם מתכננים חתונה, אולי תרצו לשתף פעולה עם בן/בת הזוג שלכם.",
    buttons: [
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("דלג", false),
      createButton("המשך"),
    ],
    icon: "👥",
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
    title: "לוח הבקרה",
    text: "זה לוח הבקרה הראשי שלך. כאן תוכל/י לראות סקירה כללית של כל התכונות.",
    attachTo: {
      element: '[data-tour="wedding-dashboard"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📊",
  },

  // TASKS
  {
    id: "tasks-intro",
    title: "משימות התכנון",
    text: "עכשיו בואו נלך לחלק המשימות כדי לנהל את רשימת בדיקת התכנון שלך.",
    buttons: [
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("עבור למשימות", true, navigateAndContinue("/tasks", 1200)),
    ],
    icon: "✅",
  },

  {
    id: "tasks-overview",
    title: "לוח בקרה של משימות",
    text: "זה המקום שבו אתה עוקב אחר כל משימות התכנון של החתונה שלך.",
    attachTo: {
      element: '[data-tour="tasks-container"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📋",
  },

  {
    id: "add-task",
    title: "הוסף משימה",
    text: "לחץ על כפתור 'הוסף משימה' כדי ליצור משימת תכנון חדשה.",
    attachTo: {
      element: '[data-tour="add-task-btn"]',
      on: "bottom",
    },
    buttons: [
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("המשך", true, openModalAndContinue('[data-tour="add-task-btn"]', 600)),
    ],
    icon: "➕",
  },

  {
    id: "task-form",
    title: "יצירת משימה",
    text: "הזן את פרטי המשימה: תיאור, עדיפות (נמוכה, בינונית, גבוהה) והקצאה.",
    buttons: getStandardButtons(),
    icon: "🎯",
  },

  {
    id: "task-management",
    title: "ניהול משימות",
    text: "אתה יכול לערוך או למחוק משימות. משימות שהושלמו יכולות להיות מסומנות כבוצעות.",
    attachTo: {
      element: '[data-tour="task-item"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🛠️",
  },

  // BUDGET
  {
    id: "budget-intro",
    title: "תקציב וספקים",
    text: "עכשיו בואו נלך לתקציב כדי להתחיל לנהל את תקציב החתונה שלך.",
    buttons: [
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("עבור לתקציב", true, navigateAndContinue("/budget", 1200)),
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
    buttons: getStandardButtons(),
    icon: "📈",
  },

  {
    id: "guest-count",
    title: "מספר אורחים",
    text: "הזן את מספר האורחים הצפוי. זה עוזר לך לחשב תקציב לאדם.",
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
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("המשך", true, openModalAndContinue('[data-tour="add-category-btn"]', 600)),
    ],
    icon: "🏷️",
  },

  {
    id: "category-example",
    title: "קטגוריה",
    text: "כל קטגוריה מציגה את התקציב שלה וסכום שהוצא. אתה יכול להרחיב כדי לראות ספקים.",
    attachTo: {
      element: '[data-tour="budget-category"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📂",
  },

  {
    id: "add-vendor",
    title: "הוסף ספק",
    text: "לחץ על 'הוסף ספק' כדי להוסיף ספק לקטגוריה.",
    buttons: getStandardButtons(),
    icon: "🤝",
  },

  {
    id: "vendor-details",
    title: "פרטי ספק",
    text: "כל ספק מציג את מחיר הצעת החוק וסטטוס. אתה יכול לעקוב אחר תשלומים.",
    buttons: getStandardButtons(),
    icon: "📄",
  },

  {
    id: "payment-status",
    title: "סטטוס תשלום",
    text: "'מלא' = שולם לחלוטין, 'חלקי' = שעשית חלק מההצעה.",
    buttons: getStandardButtons(),
    icon: "✔️",
  },

  {
    id: "add-payment",
    title: "רשום תשלום",
    text: "לחץ על ספק ובחר 'הוסף תשלום' כדי לרשום כמה שולמת.",
    buttons: getStandardButtons(),
    icon: "💳",
  },

  {
    id: "upload-contract",
    title: "העלה חוזה",
    text: "אתה יכול להעלות קבצי חוזה לספקים על ידי לחיצה על 'הוסף קובץ'.",
    buttons: getStandardButtons(),
    icon: "📎",
  },

  // RSVP
  {
    id: "rsvp-intro",
    title: "אישורי הגעה",
    text: "עכשיו בואו נלך לאישורי הגעה. זו התכונה העיקרית של המערכת.",
    buttons: [
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("עבור לאישורי הגעה", true, navigateAndContinue("/rsvp", 1200)),
    ],
    icon: "📬",
  },

  {
    id: "rsvp-overview",
    title: "לוח בקרה - אישורים",
    text: "זה המקום שבו אתה מנהל את רשימת האורחים שלך וסטטיסטיקות התגובות.",
    attachTo: {
      element: '[data-tour="rsvp-container"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📊",
  },

  {
    id: "add-guests-intro",
    title: "הוספת אורחים",
    text: "יש שתי דרכים להוסיף אורחים: העלה קובץ Excel או הוסף אחד אחד.",
    attachTo: {
      element: '[data-tour="add-guests-btn"]',
      on: "bottom",
    },
    buttons: [
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("המשך", true, openModalAndContinue('[data-tour="add-guests-btn"]', 600)),
    ],
    icon: "👫",
  },

  {
    id: "excel-upload",
    title: "העלאת אורחים",
    text: "הורד תבנית, מלא אותה עם מידע האורחים שלך והעלה אותה.",
    buttons: getStandardButtons(),
    icon: "📊",
  },

  {
    id: "manual-tab",
    title: "העלאה ידנית",
    text: "הלשונית 'ידנית' מיועדת לאורחים ללא מספרי טלפון או טלפון בכלל.",
    buttons: getStandardButtons(),
    icon: "⌨️",
  },

  {
    id: "single-guest",
    title: "אורח יחיד",
    text: "אתה יכול גם להוסיף אורחים אחד אחד על ידי מילוי הטופס.",
    buttons: getStandardButtons(),
    icon: "👤",
  },

  {
    id: "guest-list-explanation",
    title: "רשימת האורחים",
    text: "ברגע שהוספת אורחים, תראה אותם בטבלה עם מידע וסטטוס.",
    attachTo: {
      element: '[data-tour="guests-table"]',
      on: "top",
    },
    buttons: getStandardButtons(),
    icon: "📋",
  },

  {
    id: "send-invitations",
    title: "שלח הזמנות",
    text: "כ-3 שבועות לפני החתונה, לחץ על 'שליחת הודעות' ובחר 'שלח הזמנה'.",
    attachTo: {
      element: '[data-tour="send-messages-btn"]',
      on: "bottom",
    },
    buttons: [
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("המשך", true, openModalAndContinue('[data-tour="send-messages-btn"]', 600)),
    ],
    icon: "💌",
  },

  {
    id: "resend-strategy",
    title: "תזכורות עוקבות",
    text: "לאחר ההזמנה, שלח תזכורות: שבוע אחרי זאת ואז כל 3 ימים אם צריך.",
    buttons: getStandardButtons(),
    icon: "🔔",
  },

  {
    id: "selective-sending",
    title: "הזמנות בחירה",
    text: "בעת שליחת הודעות, אתה יכול לבחור אורחים ספציפיים או לשלוח לכולם.",
    buttons: getStandardButtons(),
    icon: "✋",
  },

  {
    id: "rsvp-responses",
    title: "תגובות",
    text: "כאשר אורחים משיבים, התגובות שלהם מופיעות כאן עם הסטטוס שלהם.",
    attachTo: {
      element: '[data-tour="rsvp-stats"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "💬",
  },

  {
    id: "guest-filters",
    title: "סינון אורחים",
    text: "סנן אורחים לפי סטטוס (אישר, דחה, ממתין) כדי להתמקד עם מי שעדיין צריך להשיב.",
    attachTo: {
      element: '[data-tour="filter-controls"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🔍",
  },

  {
    id: "export-rsvp",
    title: "ייצוא נתונים",
    text: "לחץ על 'ייצוא' כדי להוריד את הנתונים בעמודה Excel לשיתוף עם הספקים.",
    attachTo: {
      element: '[data-tour="export-btn"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📥",
  },

  {
    id: "reminders",
    title: "תזכורות חתונה",
    text: "אתה יכול לשלוח תזכורות ביום הקודם או ביום עצמו של החתונה.",
    buttons: getStandardButtons(),
    icon: "⏰",
  },

  {
    id: "thank-you-messages",
    title: "הודעות תודה",
    text: "ביום אחרי החתונה, אורחים קוראים הודעת תודה אוטומטית.",
    buttons: getStandardButtons(),
    icon: "🙏",
  },

  {
    id: "additional-events",
    title: "אירועים נוספים",
    text: "אתה יכול ליצור אירועים נוספים כמו חינה או קבלת פנים.",
    buttons: getStandardButtons(),
    icon: "🎉",
  },

  {
    id: "sub-events",
    title: "אורחים לאירועים",
    text: "לאירועים משניים, תחילה שדר אורחים לחתונה, ואז בחר למי ישלחו הזמנות.",
    buttons: getStandardButtons(),
    icon: "🎪",
  },

  // GIFTS
  {
    id: "gifts-intro",
    title: "מתנות חתונה",
    text: "עכשיו בואו נלך למתנות כדי לעקוב אחר מתנות מהאורחים.",
    buttons: [
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("עבור למתנות", true, navigateAndContinue("/gifts", 1200)),
    ],
    icon: "🎁",
  },

  {
    id: "gifts-overview",
    title: "לוח בקרה - מתנות",
    text: "דף זה מציג את האורחים שהוזמנו. כאן תוכל/י לעקוב אחר המתנות שלהם.",
    attachTo: {
      element: '[data-tour="gifts-container"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "📦",
  },

  {
    id: "search-guests",
    title: "חפש אורח",
    text: "חפש אורח לפי שם כדי למצוא אותו ולרשום את המתנה.",
    attachTo: {
      element: '[data-tour="guest-search"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "🔎",
  },

  {
    id: "record-gift",
    title: "רשום מתנה",
    text: "לחץ על אורח כדי לרשום: כמה בא בפועל, סוג המתנה וההסכום.",
    buttons: getStandardButtons(),
    icon: "✍️",
  },

  {
    id: "gift-types",
    title: "סוגי מתנות",
    text: "סווג מתנות כמתנה כספית, פריט או אחר.",
    buttons: getStandardButtons(),
    icon: "🏷️",
  },

  {
    id: "non-invited-guests",
    title: "אורחים שלא הוזמנו",
    text: "רשום מתנות מאנשים שלא היו ברשימת ההזמנה המקורית.",
    buttons: getStandardButtons(),
    icon: "🤷",
  },

  {
    id: "gift-stats",
    title: "סטטיסטיקות",
    text: "הצג סה״כ מתנות כספיות וספירה לפי סוג.",
    buttons: getStandardButtons(),
    icon: "📊",
  },

  {
    id: "export-gifts",
    title: "ייצוא מתנות",
    text: "ייצא את כל מידע המתנות ל-Excel כדי לשתף עם מי שצריך לשלוח תודה.",
    buttons: getStandardButtons(),
    icon: "📥",
  },

  // Post-Wedding
  {
    id: "post-wedding-intro",
    title: "לאחר החתונה",
    text: "בואו נדבר על מה קורה אחרי יום החתונה.",
    buttons: getStandardButtons(),
    icon: "🌙",
  },

  {
    id: "cleanup-flow",
    title: "ניקיון של 60 יום",
    text: "60 ימים אחרי החתונה, אתה תקבל אימייל עם כל נתוני החתונה שלך.",
    buttons: getStandardButtons(),
    icon: "🗑️",
  },

  {
    id: "data-export",
    title: "הורדת הנתונים",
    text: "הורד את כל הנתונים בכל זמן מתפריט המשתמש - אורחים, אישורים, מתנות ותקציב.",
    attachTo: {
      element: '[data-tour="user-menu"]',
      on: "bottom",
    },
    buttons: getStandardButtons(),
    icon: "💾",
  },

  // Final
  {
    id: "tour-complete",
    title: "!בהצלחה",
    text: "מזל טוב! אתה/את כעת יודע/ת כיצד להשתמש במערכת. התחל בבן/בת הזוג, ואז: משימות → תקציב → אישורי הגעה → מתנות.",
    buttons: [
      {
        action: () => {
          const tour = (window as any).shepherdTour;
          tour?.back();
        },
        text: "הקודם",
        classes: "btn btn-secondary",
      },
      createButton("סיום סיור"),
    ],
    icon: "✨",
  },
];
