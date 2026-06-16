import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Loader } from "@wix/design-system";
import { Calendar } from "lucide-react";
import { Event } from "../../types";
import "./css/WeddingCountdown.css";

interface CountdownTime {
  days: number;
  months: number;
  totalDays: number;
}

const calculateCountdown = (weddingDate: string): CountdownTime | null => {
  const wedding = new Date(weddingDate);
  const today = new Date();

  // Reset time to start of day for accurate calculation
  today.setHours(0, 0, 0, 0);
  wedding.setHours(0, 0, 0, 0);

  const diffTime = wedding.getTime() - today.getTime();
  const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  const months = Math.floor(totalDays / 30);
  const days = totalDays % 30;

  return { days, months, totalDays };
};

const formatWeddingDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString("he-IL", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

interface WeddingCountdownProps {
  weddingInfo: Event | null;
  isLoading: boolean;
}

export const WeddingCountdown = ({
  weddingInfo,
  isLoading,
}: WeddingCountdownProps) => {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState<CountdownTime | null>(null);

  useEffect(() => {
    if (weddingInfo?.date) {
      setCountdown(calculateCountdown(weddingInfo.date));
    }
  }, [weddingInfo?.date]);

  if (isLoading) {
    return (
      <div className="countdown-loading">
        <Loader size="small" />
      </div>
    );
  }

  if (weddingInfo?.date && countdown) {
    return (
      <Box
        direction="vertical"
        gap="4px"
        background={"#ffffff"}
        width={"max-content"}
        alignSelf="center"
        padding="0px 24px"
        borderRadius="8px"
      >
        <div className="countdown-container" dir="rtl">
          <div className="countdown-header">
            <Calendar className="countdown-calendar-icon" />
            <span className="countdown-label">ספירה לאחור ליום הגדול</span>
          </div>

          <div className="countdown-display">
            {countdown.months > 0 && (
              <div className="countdown-unit">
                <span className="countdown-number">{countdown.months}</span>
                <span className="countdown-text">
                  {countdown.months === 1 ? "חודש" : "חודשים"}
                </span>
              </div>
            )}
            <div className="countdown-unit">
              <span className="countdown-number">{countdown.days}</span>
              <span className="countdown-text">
                {countdown.days === 1 ? "יום" : "ימים"}
              </span>
            </div>
          </div>

          <div className="countdown-date">
            <span className="date-label">
              {formatWeddingDate(weddingInfo.date)}
            </span>
            {weddingInfo.time && (
              <span className="time-label">בשעה {weddingInfo.time}</span>
            )}
            {weddingInfo.location && (
              <span className="location-label">
                📍 {weddingInfo.location}
              </span>
            )}
          </div>
        </div>
      </Box>
    );
  }

  return (
    <Box
      direction="vertical"
      gap="4px"
      background={"#ffffff"}
      width={"max-content"}
      alignSelf="center"
      padding="0px 24px"
      borderRadius="8px"
    >
      <div className="countdown-container countdown-empty" dir="rtl">
        <Calendar className="countdown-calendar-icon" />
        <p className="countdown-empty-text">
          הגדירו את תאריך החתונה בניהול אישורי ההגעה כדי לראות את הספירה לאחור!
        </p>
        <Button size="small" onClick={() => navigate("/rsvp")}>
          הגדרת תאריך החתונה
        </Button>
      </div>
    </Box>
  );
};
