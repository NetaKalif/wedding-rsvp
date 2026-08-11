import React, { useState } from "react";
import { Box, Text, Badge, IconButton, Tooltip } from "@wix/design-system";
import { Trash2, Check, Circle, Pencil } from "lucide-react";
import { Task } from "../../types";
import { PRIORITY_LABELS, getAssigneeLabel } from "./taskConstants";
import TaskForm, { TaskFormValues } from "./TaskForm";

interface TaskItemProps {
  task: Task;
  onToggleComplete: (task: Task) => void;
  onDelete: (taskId: number) => void;
  onEdit: (
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

export const TaskItem: React.FC<TaskItemProps> = ({
  task,
  onToggleComplete,
  onDelete,
  onEdit,
  brideAndGroomNames,
}) => {
  const [isEditing, setIsEditing] = useState(false);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleEditSubmit = async (values: TaskFormValues) => {
    await onEdit(task.task_id, {
      title: values.title,
      priority: values.priority,
      assignee: values.assignee,
      timeline_group: values.timeline_group,
    });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="task-item editing">
        <TaskForm
          initialValues={{
            title: task.title,
            priority: task.priority || 2,
            assignee: task.assignee || "both",
            timeline_group: task.timeline_group,
          }}
          onSubmit={handleEditSubmit}
          onCancel={() => setIsEditing(false)}
          brideAndGroomNames={brideAndGroomNames}
          compact
        />
      </div>
    );
  }

  return (
    <div
      className={`task-item ${task.is_completed ? "completed" : ""}`}
      data-tour="task-item"
    >
      <Box
        direction="horizontal"
        verticalAlign="middle"
        gap="12px"
        className="task-content"
      >
        <button
          className={`task-checkbox ${task.is_completed ? "checked" : ""}`}
          onClick={() => onToggleComplete(task)}
        >
          {task.is_completed ? <Check size={14} /> : <Circle size={14} />}
        </button>

        <Box
          direction="horizontal"
          verticalAlign="space-between"
          gap="4px"
          className="task-details"
        >
          <Text
            size="small"
            className={task.is_completed ? "task-title-completed" : ""}
          >
            {task.title}
          </Text>
          <Box direction="horizontal" gap="8px">
            {task.assignee && (
              <Badge size="tiny" skin="neutralLight">
                {getAssigneeLabel(
                  task.assignee,
                  brideAndGroomNames.bride_name,
                  brideAndGroomNames.groom_name
                )}
              </Badge>
            )}
            {task.priority && (
              <Badge
                size="tiny"
                skin={
                  task.priority === 1
                    ? "danger"
                    : task.priority === 2
                    ? "warning"
                    : "neutralStandard"
                }
              >
                {PRIORITY_LABELS[task.priority].label}
              </Badge>
            )}
          </Box>
        </Box>

        <Box direction="horizontal" gap="4px" className="task-actions">
          <Tooltip content="עריכת משימה">
            <IconButton
              size="tiny"
              skin="light"
              className="edit-task-btn"
              onClick={handleStartEdit}
            >
              <Pencil size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip content="מחיקת משימה">
            <IconButton
              size="tiny"
              skin="light"
              className="delete-task-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task.task_id);
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </div>
  );
};

export default TaskItem;
