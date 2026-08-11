import React from "react";
import { Box, Text, Badge, Card } from "@wix/design-system";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Task, TimelineGroup } from "../../types";
import { TIMELINE_ICONS, TIMELINE_LABELS } from "./taskConstants";
import TaskItem from "./TaskItem";

interface TaskGroupProps {
  group: TimelineGroup;
  tasks: Task[];
  isExpanded: boolean;
  hideCompleted: boolean;
  onToggleExpand: (group: string) => void;
  onToggleComplete: (task: Task) => void;
  onDeleteTask: (taskId: number) => void;
  onEditTask: (
    taskId: number,
    updates: Partial<
      Pick<Task, "title" | "priority" | "assignee" | "timeline_group">
    >
  ) => Promise<void>;
  brideAndGroomNames: {
    bride_name: string;
    groom_name: string;
  };
}

export const TaskGroup: React.FC<TaskGroupProps> = ({
  group,
  tasks,
  isExpanded,
  hideCompleted,
  onToggleExpand,
  onToggleComplete,
  onDeleteTask,
  onEditTask,
  brideAndGroomNames,
}) => {
  const filteredTasks = hideCompleted
    ? tasks.filter((t) => !t.is_completed)
    : tasks;
  const completedInGroup = tasks.filter((t) => t.is_completed).length;

  // Don't render if hiding completed and no tasks to show
  if (filteredTasks.length === 0 && hideCompleted) {
    return null;
  }

  return (
    <Card className="task-group-card">
      <div
        className="task-group-header"
        onClick={() => onToggleExpand(group)}
        data-tour={group === "Just Engaged" ? "first-task-group" : undefined}
      >
        <Box
          direction="horizontal"
          verticalAlign="middle"
          gap="12px"
          className="group-header-content"
        >
          <span className="timeline-icon">{TIMELINE_ICONS[group]}</span>
          <Text weight="bold">{TIMELINE_LABELS[group]}</Text>
          <Badge size="tiny" skin="neutralLight">
            {completedInGroup}/{tasks.length}
          </Badge>
        </Box>
        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
      </div>

      {isExpanded && filteredTasks.length > 0 && (
        <div className="task-list">
          {filteredTasks.map((task) => (
            <TaskItem
              key={task.task_id}
              task={task}
              onToggleComplete={onToggleComplete}
              onDelete={onDeleteTask}
              onEdit={onEditTask}
              brideAndGroomNames={brideAndGroomNames}
            />
          ))}
        </div>
      )}

      {isExpanded && filteredTasks.length === 0 && (
        <Box padding="16px" align="center">
          <Text size="small" secondary>
            {hideCompleted
              ? "כל המשימות הושלמו! 🎉"
              : "אין משימות בתקופה זו"}
          </Text>
        </Box>
      )}
    </Card>
  );
};

export default TaskGroup;
