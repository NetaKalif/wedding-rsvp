import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import InfoModal from "./InfoModal";
import * as useAuthModule from "../../hooks/useAuth";
import { httpRequests } from "../../httpClient";
import { Event } from "../../types";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    saveEventInfo: jest.fn(),
    getPrimaryImageUrl: jest.fn(),
  },
}));

jest.mock("../../hooks/useAuth");

// emoji-picker-react pulls in browser APIs jsdom doesn't provide
jest.mock("emoji-picker-react", () => () => null);

const mockUseAuth = useAuthModule.useAuth as jest.MockedFunction<typeof useAuthModule.useAuth>;
const mockSaveEventInfo = httpRequests.saveEventInfo as jest.Mock;
const mockGetPrimaryImageUrl = httpRequests.getPrimaryImageUrl as jest.Mock;

const weddingInfo: Event = {
  id: 1,
  user_id: "user-1",
  is_primary: true,
  ceremony_name: "חתונה",
  bride_name: "דנה",
  groom_name: "יוסי",
  date: "2027-06-01",
  time: "20:00",
  location: "אולם הדקל",
  file_id: "existing-file-id",
};

const mockAuthValue = (info: Event) =>
  ({
    user: { userID: "user-1" },
    weddingInfo: info,
    refreshWeddingInfo: jest.fn().mockResolvedValue(undefined),
  } as any);

// CRA's jest config resets mock implementations before each test, so they are
// (re)defined here rather than in the jest.mock factory.
beforeEach(() => {
  mockUseAuth.mockReturnValue(mockAuthValue(weddingInfo));
  mockSaveEventInfo.mockResolvedValue({});
  mockGetPrimaryImageUrl.mockResolvedValue("https://server.test/primary-image");
});

// Saving is blocked until the existing invitation image resolves — wait for it.
const renderModal = async (info: Event = weddingInfo) => {
  mockUseAuth.mockReturnValue(mockAuthValue(info));
  render(<InfoModal isOpen setIsInfoModalOpen={jest.fn()} />);
  await waitFor(() =>
    expect(document.querySelector('img[src="https://server.test/primary-image"]')).toBeInTheDocument()
  );
};

const thankYouCheckbox = () =>
  document.querySelector('input[type="checkbox"]') as HTMLInputElement;

const save = () => fireEvent.click(screen.getByText("שמירה"));

// Steps in the wizard's steps bar are freely clickable
const goToStep = (stepTitle: string) => fireEvent.click(screen.getByText(stepTitle));

describe("InfoModal - wizard steps", () => {
  it("starts on the wedding-details step", async () => {
    await renderModal();

    expect(screen.getByText("שם הכלה")).toBeInTheDocument();
    expect(screen.queryByText("הגדרות תזכורת")).not.toBeInTheDocument();
    expect(screen.queryByText("הודעת תודה אוטומטית")).not.toBeInTheDocument();
  });

  it("jumps directly to a step when it is clicked in the steps bar", async () => {
    await renderModal();

    goToStep("תזכורת לאורחים");
    expect(screen.getByText("הגדרות תזכורת")).toBeInTheDocument();
    expect(screen.queryByText("שם הכלה")).not.toBeInTheDocument();

    goToStep("הודעת תודה");
    expect(screen.getByText("הודעת תודה אוטומטית")).toBeInTheDocument();
    expect(screen.queryByText("הגדרות תזכורת")).not.toBeInTheDocument();
  });

  it("advances through the steps with the next button, which disappears on the last step", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("הבא"));
    expect(screen.getByText("הגדרות תזכורת")).toBeInTheDocument();

    fireEvent.click(screen.getByText("הבא"));
    expect(screen.getByText("הודעת תודה אוטומטית")).toBeInTheDocument();
    expect(screen.queryByText("הבא")).not.toBeInTheDocument();
  });

  it("saving with a missing required field shows an error and returns to the first step", async () => {
    await renderModal({ ...weddingInfo, bride_name: "" });

    goToStep("הודעת תודה");
    save();

    expect(
      await screen.findByText("אנא מלאו את כל השדות הנדרשים והעלו תמונת הזמנה")
    ).toBeInTheDocument();
    expect(screen.getByText("שם הכלה")).toBeInTheDocument();
    expect(mockSaveEventInfo).not.toHaveBeenCalled();
  });

  it("saves the whole form from any step without walking through the others", async () => {
    await renderModal();

    goToStep("תזכורת לאורחים");
    save();

    await waitFor(() => expect(mockSaveEventInfo).toHaveBeenCalled());
    expect(mockSaveEventInfo).toHaveBeenCalledWith(
      expect.objectContaining({ bride_name: "דנה", location: "אולם הדקל" }),
      undefined
    );
  });
});

describe("InfoModal - automatic thank-you message setting", () => {
  it("defaults to off and saves send_thank_you=false", async () => {
    await renderModal();

    goToStep("הודעת תודה");
    expect(thankYouCheckbox().checked).toBe(false);
    save();

    await waitFor(() => expect(mockSaveEventInfo).toHaveBeenCalled());
    expect(mockSaveEventInfo).toHaveBeenCalledWith(
      expect.objectContaining({ send_thank_you: false }),
      undefined
    );
  });

  it("saves send_thank_you=true when the checkbox is turned on", async () => {
    await renderModal();

    goToStep("הודעת תודה");
    fireEvent.click(screen.getByText("שליחת הודעת תודה אוטומטית לאורחים יום לאחר החתונה"));
    save();

    await waitFor(() => expect(mockSaveEventInfo).toHaveBeenCalled());
    expect(mockSaveEventInfo).toHaveBeenCalledWith(
      expect.objectContaining({ send_thank_you: true }),
      undefined
    );
  });

  it("prefills the checkbox from the saved wedding info", async () => {
    await renderModal({ ...weddingInfo, send_thank_you: true });

    goToStep("הודעת תודה");
    expect(thankYouCheckbox().checked).toBe(true);
  });

  it("shows the fixed template text with the couple's names around the custom message input", async () => {
    await renderModal();

    goToStep("הודעת תודה");
    fireEvent.click(screen.getByText("שליחת הודעת תודה אוטומטית לאורחים יום לאחר החתונה"));

    expect(screen.getByText("אורחים יקרים,")).toBeInTheDocument();
    expect(screen.getByText("אוהבים,")).toBeInTheDocument();
    expect(screen.getByText("דנה ויוסי ❤️")).toBeInTheDocument();
  });

  it("only shows the custom thank-you message field when the checkbox is checked", async () => {
    await renderModal();

    goToStep("הודעת תודה");
    expect(screen.queryByText("הודעת תודה מותאמת אישית")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("שליחת הודעת תודה אוטומטית לאורחים יום לאחר החתונה"));
    expect(screen.getByText("הודעת תודה מותאמת אישית")).toBeInTheDocument();

    fireEvent.click(screen.getByText("שליחת הודעת תודה אוטומטית לאורחים יום לאחר החתונה"));
    expect(screen.queryByText("הודעת תודה מותאמת אישית")).not.toBeInTheDocument();
  });
});
