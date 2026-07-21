import React from "react";
import { Box } from "@wix/design-system";
import "@wix/design-system/styles.global.css";
import "./css/PendingApproval.css";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import { Clock, Phone } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";

const ADMIN_PHONE = "054-554-1120";

const PendingApprovalPage = () => {
  const { handleLoginSuccess, handleLogout } = useAuth();
  const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
  if (!CLIENT_ID) {
    throw new Error("REACT_APP_GOOGLE_CLIENT_ID is not set in .env file");
  }

  return (
    <div className="pending-approval" dir="rtl">
      <Box
        direction="vertical"
        align="center"
        gap="SP4"
        padding="SP10"
        className="pending-approval-card"
      >
        <Clock className="pending-approval-icon" />
        <h1 style={{ margin: "4px" }}>הבקשה שלך התקבלה</h1>
        <span className="pending-approval-text">
          תודה שנרשמת! החשבון שלך ממתין כעת לאישור המנהל/ת של המערכת. ברגע
          שהחשבון יאושר, תוכל/י להתחבר ולקבל גישה מלאה.
        </span>

        <Box
          direction="vertical"
          align="center"
          gap="SP1"
          padding="SP3 SP5"
          backgroundColor="WHITE"
          borderRadius="SP3"
          className="pending-approval-contact"
        >
          <Box gap="SP1" verticalAlign="middle">
            <Phone className="pending-approval-phone-icon" />
            <span>לבירורים ניתן לפנות בטלפון: {ADMIN_PHONE}</span>
          </Box>
        </Box>

        <Box direction="vertical" gap="SP2" align="center">
          <span className="pending-approval-recheck-label">
            כבר אושרת? התחבר/י שוב כדי לבדוק את הסטטוס:
          </span>
          <GoogleOAuthProvider clientId={CLIENT_ID}>
            <GoogleLogin
              onSuccess={(res) => handleLoginSuccess(res)}
              onError={() => alert("ההתחברות נכשלה")}
              theme="outline"
              size="large"
              shape="circle"
              width="250"
              locale="he"
            />
          </GoogleOAuthProvider>
          <button className="pending-approval-signout" onClick={handleLogout}>
            התנתקות
          </button>
        </Box>
      </Box>
    </div>
  );
};

export default PendingApprovalPage;
