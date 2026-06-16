import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Heading, Text, Loader } from "@wix/design-system";
import "@wix/design-system/styles.global.css";
import { Task, TimelineGroup, TaskPriority, TaskAssignee } from "../../types";
import { httpRequests } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import Header from "../global/Header";
import TaskProgressCard from "./TaskProgressCard";
import TaskGroup from "./TaskGroup";
import { TIMELINE_GROUPS } from "./taskConstants";
import "./css/TasksDashboard.css";
import TaskForm from "./TaskForm";

interface GroupedTasks {
  [key: string]: Task[];
}

export const TasksDashboard: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(TIMELINE_GROUPS)
  );
  const [showAddTask, setShowAddTask] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [brideAndGroomNames, setBrideAndGroomNames] = useState<{
    bride_name: string;
    groom_name: string;
  }>({
    bride_name: "",
    groom_name: "",
  });

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const weddingInfoPromise = httpRequests.getPrimaryEvent(user.userID);
      const tasksPromise = httpRequests.getTasks(user.userID);
      const [weddingInfo, fetchedTasks] = await Promise.all([
        weddingInfoPromise,
        tasksPromise,
      ]);
      setBrideAndGroomNames({
        bride_name: weddingInfo?.bride_name || "",
        groom_name: weddingInfo?.groom_name || "",
      });
      setTasks(fetchedTasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user && !authLoading) {
      fetchData();
    }
  }, [user, authLoading, fetchData]);

  const handleToggleComplete = async (task: Task) => {
    if (!user) return;
    try {
      const updatedTask = await httpRequests.updateTaskCompletion(
        user.userID,
        task.task_id,
        !task.is_completed
      );
      setTasks((prev) =>
        prev.map((t) => (t.task_id === task.task_id ? updatedTask : t))
      );
    } catch (error) {
      console.error("Error updating task:", error);
    }
  };

  const handleAddTask = async (newTask: {
    title: string;
    timeline_group: TimelineGroup;
    priority: TaskPriority;
    assignee: TaskAssignee;
  }) => {
    if (!user) return;
    try {
      const createdTask = await httpRequests.addTask(user.userID, newTask);
      setTasks((prev) => [...prev, createdTask]);
    } catch (error) {
      console.error("Error adding task:", error);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!user) return;
    try {
      await httpRequests.deleteTask(user.userID, taskId);
      setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
    } catch (error) {
      console.error("Error deleting task:", error);
    }
  };

  const handleEditTask = async (
    taskId: number,
    updates: Partial<
      Pick<Task, "title" | "priority" | "assignee" | "timeline_group">
    >
  ) => {
    if (!user) return;
    try {
      const updatedTask = await httpRequests.updateTask(
        user.userID,
        taskId,
        updates
      );
      setTasks((prev) =>
        prev.map((t) => (t.task_id === taskId ? updatedTask : t))
      );
    } catch (error) {
      console.error("Error updating task:", error);
      throw error;
    }
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(group)) {
        newSet.delete(group);
      } else {
        newSet.add(group);
      }
      return newSet;
    });
  };

  const allExpanded = expandedGroups.size === TIMELINE_GROUPS.length;

  const toggleAllGroups = () => {
    if (allExpanded) {
      setExpandedGroups(new Set());
    } else {
      setExpandedGroups(new Set(TIMELINE_GROUPS));
    }
  };

  // Group tasks by timeline
  const groupedTasks: GroupedTasks = tasks.reduce((acc, task) => {
    const group = task.timeline_group;
    if (!acc[group]) {
      acc[group] = [];
    }
    acc[group].push(task);
    return acc;
  }, {} as GroupedTasks);

  const completedCount = tasks.filter((t) => t.is_completed).length;
  const totalCount = tasks.length;

  // Loading state
  if (authLoading || isLoading) {
    return (
      <div className="tasks-dashboard">
        <Header />
        <Box
          direction="vertical"
          align="center"
          verticalAlign="middle"
          height="50vh"
        >
          <Loader size="medium" />
        </Box>
      </div>
    );
  }

  // Redirect if not logged in
  if (!user) {
    navigate("/");
    return null;
  }

  return (
    <div className="tasks-dashboard">
      <Header showBackToDashboardButton={true} />

      <Box
        direction="vertical"
        gap="24px"
        padding="24px 16px"
        className="tasks-content"
      >
        {/* Header */}
        <Box direction="vertical" gap="4px">
          <Heading size="large">משימות לחתונה</Heading>
          <Text size="small" secondary>
            {completedCount} מתוך {totalCount} משימות הושלמו
          </Text>
        </Box>

        {/* Progress Card */}
        <TaskProgressCard
          completedCount={completedCount}
          totalCount={totalCount}
          hideCompleted={hideCompleted}
          allExpanded={allExpanded}
          onToggleHideCompleted={() => setHideCompleted(!hideCompleted)}
          onToggleAddTask={() => setShowAddTask(!showAddTask)}
          onToggleAllGroups={toggleAllGroups}
        />

        {/* Add Task Form */}
        {showAddTask && (
          <TaskForm
            onSubmit={handleAddTask}
            onCancel={() => setShowAddTask(false)}
            brideAndGroomNames={brideAndGroomNames}
          />
        )}

        {/* Task Groups */}
        <Box direction="vertical" gap="16px" className="task-groups">
          {TIMELINE_GROUPS.map((group) => (
            <TaskGroup
              key={group}
              group={group}
              tasks={groupedTasks[group] || []}
              isExpanded={expandedGroups.has(group)}
              hideCompleted={hideCompleted}
              onToggleExpand={toggleGroup}
              onToggleComplete={handleToggleComplete}
              onDeleteTask={handleDeleteTask}
              onEditTask={handleEditTask}
              brideAndGroomNames={brideAndGroomNames}
            />
          ))}
        </Box>
      </Box>
    </div>
  );
};

export default TasksDashboard;
