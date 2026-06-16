import { httpRequests } from "../../httpClient";
import { EventGuest, FilterOptions, Guest, SetGuestsList, User } from "../../types";
import { Workbook } from "exceljs";

export const formatPhoneNumber = (phone: string): string => {
  if (phone.startsWith("0")) return `+972${phone.slice(1)}`;
  if (phone.startsWith("5")) return `+972${phone}`;
  return phone;
};

export const validatePhoneNumber = (
  phone: Guest["phone"]
): string | undefined => {
  const formattedPhone = formatPhoneNumber(phone.toString());
  const phoneRegex = /^\+9725\d{8}$/;
  if (!phoneRegex.test(formattedPhone)) {
    return;
  }

  return formattedPhone;
};

export const getRsvpCounts = (guestsList: EventGuest[]) => {
  const counts = {
    pending: 0,
    confirmed: 0,
    declined: 0,
  };

  guestsList.forEach((guest) => {
    if (guest.rsvp_status == null) counts.pending++;
    else if (guest.rsvp_status > 0) counts.confirmed++;
    else if (guest.rsvp_status === 0) counts.declined++;
  });

  return counts;
};

const downloadXlsx = async (workbook: Workbook, filename: string) => {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const handleExport = async (guestsList: EventGuest[]) => {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet("Guests");

  if (guestsList.length > 0) {
    worksheet.columns = (Object.keys(guestsList[0]) as (keyof EventGuest)[]).map(
      (key) => ({ header: String(key), key: String(key) })
    );
    guestsList.forEach((guest) =>
      worksheet.addRow(guest as unknown as Record<string, unknown>)
    );
  }

  await downloadXlsx(workbook, "guestsListUpdated.xlsx");
};

export const handleEmptyTableTemplate = async () => {
  const columns = Object.keys(formFieldsData);
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet("Guests");

  worksheet.columns = columns.map((col) => ({ header: col, key: col }));
  worksheet.addRow(
    columns.reduce<Record<string, string>>((acc, col) => {
      acc[col] = "";
      return acc;
    }, {})
  );

  await downloadXlsx(workbook, "guests_list_template.xlsx");
};
export const formFieldsData = {
  name: {
    fieldId: 1,
    mandatory: true,
  },
  phone: {
    fieldId: 3,
    mandatory: true,
  },
  whose: {
    fieldId: 4,
    mandatory: true,
  },
  circle: {
    fieldId: 5,
    mandatory: true,
  },
  number_of_guests: {
    fieldId: 6,
    mandatory: true,
  },
};
export const requiredFields: (keyof typeof formFieldsData)[] = Object.keys(
  formFieldsData
).filter(
  (field) => formFieldsData[field as keyof typeof formFieldsData].mandatory
) as (keyof typeof formFieldsData)[];

export const validateGuestsInfo = (
  importedGuestsList: Guest[],
  currentGuestsList: Guest[]
) => {
  const badPhoneNumbers: { name: string; phone: string }[] = [];
  const duplicatedPhoneNumbers: { name: string; phone: string }[] = [];
  const guestsWithMissingData: { name: string; missingField: string }[] = [];
  const uniquePhones = new Set(currentGuestsList.map((guest) => guest.phone));
  const goodGuests = importedGuestsList.filter((row) => {
    const isGuestRequiredFieldsAreNotFull = requiredFields.some((field) => {
      if (!row[field] || row[field] === "") {
        guestsWithMissingData.push({ name: row.name, missingField: field });
        return true;
      }
      return false;
    });
    if (isGuestRequiredFieldsAreNotFull) {
      return false;
    }
    const formattedPhone = validatePhoneNumber(row.phone);
    if (!formattedPhone) {
      badPhoneNumbers.push({ name: row.name, phone: row.phone });
      return false;
    } else {
      row.phone = formattedPhone;
      if (uniquePhones.has(row.phone)) {
        duplicatedPhoneNumbers.push({ name: row.name, phone: row.phone });
        return false;
      } else {
        uniquePhones.add(row.phone);
      }

      return true;
    }
  });
  if (badPhoneNumbers.length) {
    alert(
      "Some phone numbers are invalid. This numbers will not be added now.\n You can add them manually later: \n" +
        badPhoneNumbers
          .map((row) => row.name + " phone number: " + row.phone)
          .join("\n")
    );
  }
  if (duplicatedPhoneNumbers.length) {
    alert(
      "Some phone numbers are duplicated. This numbers will not be added now.\n You can add them manually later: \n" +
        duplicatedPhoneNumbers
          .map((row) => row.name + " phone number: " + row.phone)
          .join("\n")
    );
  }
  if (guestsWithMissingData.length) {
    alert(
      "Some guests are missing required fields. This guests will not be added now.\n You can add them manually later: \n" +
        guestsWithMissingData
          .map((row) => row.name + "  missing field: " + row.missingField)
          .join("\n")
    );
  }
  return goodGuests;
};
export const handleImport = (
  userID: User["userID"],
  file: File,
  guestsList: Guest[],
  setGuestsList: SetGuestsList
) => {
  const reader = new FileReader();

  reader.onload = async (event) => {
    if (!event.target?.result) return;

    const workbook = new Workbook();
    await workbook.xlsx.load(event.target.result as Buffer);
    const worksheet = workbook.worksheets[0];

    const headers: Record<number, string> = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value);
    });

    const rawJSON: Guest[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const guest: Record<string, unknown> = {};
      Object.entries(headers).forEach(([colStr, header]) => {
        const cell = row.getCell(Number(colStr));
        guest[header] = cell.value ?? null;
      });
      rawJSON.push(guest as unknown as Guest);
    });

    const json = rawJSON.filter((row) =>
      Object.values(row).some((value) => value !== null && value !== "")
    );

    const missingColumns = requiredFields.filter(
      (field) => !Object.keys(json[0]).includes(field)
    );

    if (!json.length || requiredFields.some((field) => !(field in json[0]))) {
      alert(
        "Defected file. the columns: " +
          missingColumns.join(", ") +
          " are missing. Make sure the table has all required columns: " +
          requiredFields.join(", ")
      );
      return;
    }
    const goodGuests = validateGuestsInfo(json, guestsList);
    if (goodGuests.length === 0) return;
    const updatedGuestsList = await httpRequests.addGuests(userID, goodGuests);
    setGuestsList(updatedGuestsList);
  };

  reader.readAsArrayBuffer(file);
};

export const getUniqueValues = <T extends keyof Guest>(
  guests: Guest[],
  key: T
): string[] => {
  const values = guests.map((guest) => guest[key] as string);
  return [...new Set(values)].sort();
};

export const getUniqueEventGuestValues = <T extends keyof EventGuest>(
  guests: EventGuest[],
  key: T
): string[] => {
  const values = guests.map((guest) => guest[key] as string).filter(Boolean);
  return [...new Set(values)].sort();
};

export const getCirclesValues = (guests: Guest[]) => {
  const circlesMap: any = {};
  guests.forEach((guest) => {
    if (circlesMap[guest.whose]) {
      if (!circlesMap[guest.whose].includes(guest.circle))
        circlesMap[guest.whose].push(guest.circle);
    } else {
      circlesMap[guest.whose] = [guest.circle];
    }
  });
  return circlesMap;
};

export const getEventGuestCirclesValues = (guests: EventGuest[]) => {
  const circlesMap: Record<string, string[]> = {};
  guests.forEach((guest) => {
    const whose = guest.whose ?? "";
    const circle = guest.circle ?? "";
    if (circlesMap[whose]) {
      if (!circlesMap[whose].includes(circle))
        circlesMap[whose].push(circle);
    } else {
      circlesMap[whose] = [circle];
    }
  });
  return circlesMap;
};

export const getRsvpStatus = (
  rsvp: number | null | undefined
): "pending" | "declined" | "confirmed" => {
  if (rsvp == null) return "pending";
  if (rsvp === 0) return "declined";
  return "confirmed";
};

export const filterGuests = (
  guests: EventGuest[],
  filterOptions: FilterOptions
): EventGuest[] => {
  return guests.filter((guest) => {
    const matchesInvitedBy =
      filterOptions.whose.length === 0 ||
      (guest.whose != null && filterOptions.whose.includes(guest.whose));

    const matchesGroup =
      filterOptions.circle.length === 0 ||
      (guest.circle != null && filterOptions.circle.includes(guest.circle));

    const matchesRsvpStatus =
      filterOptions.rsvpStatus.length === 0 ||
      filterOptions.rsvpStatus.includes(getRsvpStatus(guest.rsvp_status));

    const matchesSearch =
      !filterOptions.searchTerm ||
      (guest.name && guest.name.includes(filterOptions.searchTerm)) ||
      (guest.phone && guest.phone.includes(filterOptions.searchTerm)) ||
      (guest.whose && guest.whose.includes(filterOptions.searchTerm)) ||
      (guest.circle && guest.circle.includes(filterOptions.searchTerm));

    return (
      matchesInvitedBy && matchesGroup && matchesRsvpStatus && matchesSearch
    );
  });
};

export const getNumberOfGuests = (guestsList: EventGuest[]) => {
  return guestsList.reduce((acc, guest) => acc + (guest.number_of_guests ?? 0), 0);
};

export const getNumberOfGuestsRSVP = (guestsList: EventGuest[]) => {
  return guestsList.reduce(
    (total, guest) => (guest.rsvp_status ? total + guest.rsvp_status : total),
    0
  );
};

export const getNumberOfGuestsDeclined = (guestsList: EventGuest[]) => {
  return guestsList.reduce(
    (total, guest) => (guest.rsvp_status === 0 ? total + (guest.number_of_guests ?? 0) : total),
    0
  );
};
