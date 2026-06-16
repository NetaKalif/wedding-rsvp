import "./css/GuestsList.css";
import { EventGuest, FilterOptions, RsvpStatus } from "../../types";

import React, { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FieldSet,
  Input,
  Modal,
  Text,
} from "@wix/design-system";
import { getEventGuestCirclesValues, getUniqueEventGuestValues } from "./logic";
import { Filter, Search } from "lucide-react";
interface SearchAndFilterBarProps {
  guestsList: EventGuest[];
  filterOptions: FilterOptions;
  setFilterOptions: React.Dispatch<React.SetStateAction<FilterOptions>>;
}

const SearchAndFilterBar: React.FC<SearchAndFilterBarProps> = ({
  guestsList,
  setFilterOptions,
  filterOptions,
}) => {
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const invitedByOptions = getUniqueEventGuestValues(guestsList, "whose");
  const circleOptions = getEventGuestCirclesValues(guestsList);
  const rsvpStatusOptions: RsvpStatus[] = ["pending", "confirmed", "declined"];

  const toggleInvitedByFilter = (whose: string) => {
    setFilterOptions((prev) => ({
      ...prev,
      whose: prev.whose.includes(whose)
        ? prev.whose.filter((item) => item !== whose)
        : [...prev.whose, whose],
    }));
  };

  const toggleCircleFilter = (circle: string) => {
    setFilterOptions((prev) => ({
      ...prev,
      circle: prev.circle.includes(circle)
        ? prev.circle.filter((item) => item !== circle)
        : [...prev.circle, circle],
    }));
  };

  const toggleRsvpStatusFilter = (status: RsvpStatus) => {
    setFilterOptions((prev) => ({
      ...prev,
      rsvpStatus: prev.rsvpStatus.includes(status)
        ? prev.rsvpStatus.filter((item) => item !== status)
        : [...prev.rsvpStatus, status],
    }));
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterOptions((prev) => ({
      ...prev,
      searchTerm: e.target.value,
    }));
  };

  return (
    <>
      <Box
        direction="horizontal"
        gap="12px"
        verticalAlign="middle"
        className="search-filter-container"
      >
        <Box
          direction="horizontal"
          gap="8px"
          verticalAlign="middle"
          className="search"
        >
          <Search />
          <Input
            placeholder="חיפוש אורחים..."
            value={filterOptions.searchTerm}
            onChange={handleSearchChange}
          />
        </Box>
        <Box direction="horizontal" gap="8px" className="filter">
          <Button
            size="tiny"
            onClick={() => setFilterPanelOpen(!filterPanelOpen)}
          >
            <Filter size={16} />
            סינון
          </Button>
          <Button
            onClick={() => {
              setFilterOptions({
                whose: [],
                circle: [],
                rsvpStatus: [],
                searchTerm: "",
              });
            }}
            size="tiny"
          >
            נקה מסננים
          </Button>
        </Box>
      </Box>
      <Modal
        isOpen={filterPanelOpen}
        onRequestClose={() => setFilterPanelOpen(false)}
        shouldCloseOnOverlayClick
      >
        <Box
          background="WHITE"
          borderRadius="10px"
          direction="vertical"
          gap="16px"
          padding="24px"
        >
          <Text weight="bold" size="medium">
            אפשרויות סינון
          </Text>

          <FieldSet legend="מוזמן ע״י" direction="vertical">
            {invitedByOptions.map((invitedBy) => (
              <Checkbox
                key={invitedBy}
                checked={filterOptions.whose.includes(invitedBy)}
                size="small"
                onChange={() => toggleInvitedByFilter(invitedBy)}
              >
                {invitedBy}
              </Checkbox>
            ))}
          </FieldSet>

          <FieldSet legend="מעגל" direction="vertical">
            {filterOptions.whose.length > 0 ? (
              filterOptions.whose.map((invitedBy) => (
                <FieldSet
                  legend={invitedBy}
                  direction="vertical"
                  key={invitedBy}
                >
                  <Box direction="vertical" alignContent="start">
                    {circleOptions[invitedBy]?.map((circle: string) => (
                      <Checkbox
                        key={circle}
                        checked={filterOptions.circle.includes(circle)}
                        size="small"
                        onChange={() => toggleCircleFilter(circle)}
                      >
                        {circle}
                      </Checkbox>
                    ))}
                  </Box>
                </FieldSet>
              ))
            ) : (
              <Text size="small">בחרו מוזמן ע״י כדי לסנן מעגלים</Text>
            )}
          </FieldSet>

          <FieldSet legend="סטטוס אישור" direction="vertical">
            {rsvpStatusOptions.map((status) => (
              <Checkbox
                key={status}
                checked={filterOptions.rsvpStatus.includes(status)}
                size="small"
                onChange={() => toggleRsvpStatusFilter(status)}
              >
                {status}
              </Checkbox>
            ))}
          </FieldSet>

          <Button onClick={() => setFilterPanelOpen(false)} size="small">
            סגור
          </Button>
        </Box>
      </Modal>
    </>
  );
};

export default SearchAndFilterBar;
