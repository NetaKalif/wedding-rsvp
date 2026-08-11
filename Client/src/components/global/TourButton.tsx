import React from "react";
import { useTour } from "../../hooks/useTour";
import { Button } from "@wix/design-system";
import { Tooltip } from "@wix/design-system";

export function TourButton() {
  const { startTour, hasCompletedTour } = useTour();

  return (
    <Tooltip content="Take the guided tour" placement="bottom">
      <Button
        onClick={startTour}
        priority="secondary"
        size="small"
        className="tour-button"
        title={hasCompletedTour ? "Retake the tour" : "Start the tour"}
      >
        <span>🎯 Tour</span>
      </Button>
    </Tooltip>
  );
}
