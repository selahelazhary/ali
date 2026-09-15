/* Brand defaults only — every piece of menu/branch/contact content comes from the
   dashboard and lives in Firebase. This file just keeps the app renderable before
   the first read (and if the database is ever unreachable). */
window.MENU_DATA = {
  "name": "",
  "logo": "assets/logo.png",
  "banners": [],
  "bannerAnimation": "fade",
  "primaryColor": "#F26722",
  "backgroundColor": "#FFFFFF",
  "textColor": "#2A1B12",
  "buttonTextColor": "#FFFFFF",
  "surfaceColor": "#FFF8F3",
  "languages": [
    "ar",
    "en"
  ],
  "currencyCode": "EGP",
  "currencyFractionDigits": 2,
  "menuNote": {
    "ar": "",
    "en": ""
  },
  "address": "",
  "contactNumber": "",
  "website": "",
  "instagram": "",
  "tiktok": "",
  "facebook": "",
  "whatsapp": "",
  "openingHours": "",
  "isTapForDetailsEnabled": true,
  "isRestaurantNameDisplayedOnHomePage": true,
  "fallbackProductImage": "assets/logo.png",
  "feedbackForm": {
    "title": {
      "ar": "رأيك يهمنا! شاركنا تجربتك 😊",
      "en": "Tell us about your experience! 😊"
    },
    "questions": [
      {
        "id": 1,
        "type": "rating",
        "question": {
          "ar": "تجربتك معانا بشكل عام؟",
          "en": "How was your overall experience?"
        }
      },
      {
        "id": 2,
        "type": "rating",
        "question": {
          "ar": "رأيك في جودة المنتجات؟",
          "en": "How do you rate our products?"
        }
      },
      {
        "id": 3,
        "type": "rating",
        "question": {
          "ar": "رأيك في الخدمة؟",
          "en": "What do you think about our service?"
        }
      },
      {
        "id": 4,
        "type": "text",
        "question": {
          "ar": "أي اقتراحات أو ملاحظات؟",
          "en": "Any suggestions or comments?"
        }
      },
      {
        "id": 5,
        "type": "text",
        "question": {
          "ar": "رقم التليفون (اختياري)",
          "en": "Phone number (optional)"
        }
      }
    ]
  },
  "categories": [],
  "homeBgHasLogo": false
};
