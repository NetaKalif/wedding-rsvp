import React, { useState } from "react";
import { Box, Input, Text, Button, Checkbox, Popover } from "@wix/design-system";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import { EventGuest } from "../../types";
import { getUniqueEventGuestValues } from "./logic";

interface GuestPickerProps {
  guests: EventGuest[];
  selectedGuestIds: Set<number>;
  onSelectionChange: (next: Set<number>) => void;
}

/**
 * Searchable, filterable (whose/circle) guest checklist with select-all.
 * Search/filter state is internal — remount (via `key`) to reset it.
 */
const GuestPicker: React.FC<GuestPickerProps> = ({
  guests,
  selectedGuestIds,
  onSelectionChange,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<{ whose: string[]; circle: string[] }>({
    whose: [],
    circle: [],
  });
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterSectionsOpen, setFilterSectionsOpen] = useState<{ whose: boolean; circle: boolean }>({
    whose: false,
    circle: false,
  });

  const toggleGuestSelection = (guestId: number) => {
    const next = new Set(selectedGuestIds);
    if (next.has(guestId)) {
      next.delete(guestId);
    } else {
      next.add(guestId);
    }
    onSelectionChange(next);
  };

  const toggleWhoseFilter = (whose: string) => {
    setFilters((prev) => ({
      ...prev,
      whose: prev.whose.includes(whose) ? prev.whose.filter((item) => item !== whose) : [...prev.whose, whose],
    }));
  };

  const toggleCircleFilter = (circle: string) => {
    setFilters((prev) => ({
      ...prev,
      circle: prev.circle.includes(circle) ? prev.circle.filter((item) => item !== circle) : [...prev.circle, circle],
    }));
  };

  const toggleFilterSection = (section: "whose" | "circle") => {
    setFilterSectionsOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const whoseOptions = getUniqueEventGuestValues(guests, "whose");
  const circleOptions = getUniqueEventGuestValues(guests, "circle");
  const filteredGuests = guests.filter((g) => {
    const matchesSearch = (g.name ?? "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesWhose = filters.whose.length === 0 || (g.whose != null && filters.whose.includes(g.whose));
    const matchesCircle =
      filters.circle.length === 0 || (g.circle != null && filters.circle.includes(g.circle));
    return matchesSearch && matchesWhose && matchesCircle;
  });

  const allFilteredSelected =
    filteredGuests.length > 0 && filteredGuests.every((g) => selectedGuestIds.has(g.guest_id));

  const toggleSelectAllFiltered = () => {
    const next = new Set(selectedGuestIds);
    filteredGuests.forEach((g) => {
      if (allFilteredSelected) next.delete(g.guest_id);
      else next.add(g.guest_id);
    });
    onSelectionChange(next);
  };

  return (
    <Box direction="vertical" gap={2}>
      <Text size="small" secondary style={{ display: "block" }}>
        בחרו אורחים
      </Text>
      <Box direction="horizontal" gap="8px" verticalAlign="middle" flexShrink={0}>
        <Box flex="1">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="חיפוש לפי שם..."
          />
        </Box>
        {(whoseOptions.length > 0 || circleOptions.length > 0) && (
          <Popover
            shown={isFilterOpen}
            placement="bottom-end"
            onClickOutside={() => setIsFilterOpen(false)}
            appendTo="window"
            width={300}
            zIndex={6000}
          >
            <Popover.Element>
              <Button
                priority="secondary"
                size="small"
                onClick={() => setIsFilterOpen((prev) => !prev)}
              >
                <Filter size={16} />
                <span style={{ marginRight: "6px" }}>
                  סינון{filters.whose.length + filters.circle.length > 0
                    ? ` (${filters.whose.length + filters.circle.length})`
                    : ""}
                </span>
              </Button>
            </Popover.Element>
            <Popover.Content>
              <Box
                direction="vertical"
                gap="8px"
                padding="16px"
                style={{ width: 300, maxWidth: 300, maxHeight: 360, overflowY: "auto" }}
              >
                {whoseOptions.length > 0 && (
                  <Box direction="vertical" gap="4px">
                    <div
                      onClick={() => toggleFilterSection("whose")}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                      }}
                    >
                      <Text size="small" weight="bold">
                        מוזמן ע״י
                      </Text>
                      {filterSectionsOpen.whose ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </div>
                    {filterSectionsOpen.whose && (
                      <Box direction="vertical" gap="2px">
                        {whoseOptions.map((whose) => (
                          <Checkbox
                            key={whose}
                            checked={filters.whose.includes(whose)}
                            size="small"
                            onChange={() => toggleWhoseFilter(whose)}
                          >
                            {whose}
                          </Checkbox>
                        ))}
                      </Box>
                    )}
                  </Box>
                )}
                {circleOptions.length > 0 && (
                  <Box direction="vertical" gap="4px">
                    <div
                      onClick={() => toggleFilterSection("circle")}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                      }}
                    >
                      <Text size="small" weight="bold">
                        מעגל
                      </Text>
                      {filterSectionsOpen.circle ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </div>
                    {filterSectionsOpen.circle && (
                      <Box direction="vertical" gap="2px">
                        {circleOptions.map((circle) => (
                          <Checkbox
                            key={circle}
                            checked={filters.circle.includes(circle)}
                            size="small"
                            onChange={() => toggleCircleFilter(circle)}
                          >
                            {circle}
                          </Checkbox>
                        ))}
                      </Box>
                    )}
                  </Box>
                )}
                <Button
                  priority="secondary"
                  size="tiny"
                  onClick={() => setFilters({ whose: [], circle: [] })}
                >
                  נקה מסננים
                </Button>
              </Box>
            </Popover.Content>
          </Popover>
        )}
      </Box>

      {filteredGuests.length === 0 ? (
        <Text secondary size="small">
          {guests.length === 0 ? "אין אורחים זמינים" : "לא נמצאו תוצאות"}
        </Text>
      ) : (
        <Box direction="vertical" gap={1}>
          <Box flexShrink={0}>
            <Checkbox checked={allFilteredSelected} onChange={toggleSelectAllFiltered}>
              בחר הכל ({filteredGuests.length})
            </Checkbox>
          </Box>
          <Box
            direction="vertical"
            gap={1}
            maxHeight="40vh"
            overflowY="auto"
            dataHook="guest-picker-list"
          >
            {filteredGuests.map((guest) => (
              <Checkbox
                key={guest.guest_id}
                checked={selectedGuestIds.has(guest.guest_id)}
                onChange={() => toggleGuestSelection(guest.guest_id)}
              >
                {guest.name} {guest.phone ? `(${guest.phone})` : ""}
              </Checkbox>
            ))}
          </Box>
        </Box>
      )}
      {selectedGuestIds.size > 0 && (
        <Box flexShrink={0}>
          <Text size="small" secondary>
            נבחרו {selectedGuestIds.size} אורחים
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default GuestPicker;
