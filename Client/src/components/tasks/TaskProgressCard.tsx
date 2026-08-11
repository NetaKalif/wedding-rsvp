import React from "react";
import { Box, Text, Button, Card, ToggleSwitch } from "@wix/design-system";
import { Plus, ChevronsUpDown } from "lucide-react";

interface TaskProgressCardProps {
  completedCount: number;
  totalCount: number;
  hideCompleted: boolean;
  allExpanded: boolean;
  onToggleHideCompleted: () => void;
  onToggleAddTask: () => void;
  onToggleAllGroups: () => void;
}

export const TaskProgressCard: React.FC<TaskProgressCardProps> = ({
  completedCount,
  totalCount,
  hideCompleted,
  allExpanded,
  onToggleHideCompleted,
  onToggleAddTask,
  onToggleAllGroups,
}) => {
  const progressPercent =
    totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <Card>
      <Card.Content>
        <Box direction="vertical" gap="12px">
          <Box direction="horizontal" verticalAlign="middle" gap="12px">
            <Box className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </Box>
            <Text size="small" weight="bold">
              {Math.round(progressPercent)}%
            </Text>
          </Box>
          <Box
            direction="horizontal"
            gap="12px"
            verticalAlign="middle"
            className="progress-card-actions"
          >
            <Button
              size="small"
              priority="secondary"
              onClick={onToggleAddTask}
              data-tour="add-task-btn"
            >
              <Plus size={16} />
              <span style={{ marginRight: "8px" }}>משימה</span>
            </Button>
            <Button
              size="small"
              priority="secondary"
              onClick={onToggleAllGroups}
            >
              <ChevronsUpDown size={16} />
              <span style={{ marginRight: "8px" }}>
                {allExpanded ? "כווץ" : "הרחב"}
              </span>
            </Button>
            <Box
              direction="horizontal"
              gap="8px"
              verticalAlign="middle"
              className="hide-completed-toggle"
            >
              <Text size="small">הסתר משימות שהושלמו</Text>
              <ToggleSwitch
                size="small"
                checked={hideCompleted}
                onChange={onToggleHideCompleted}
              />
            </Box>
          </Box>
        </Box>
      </Card.Content>
    </Card>
  );
};

export default TaskProgressCard;
