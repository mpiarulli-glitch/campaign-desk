/**
 * Brand kits taken from the guides the team uploaded.
 * Applied only when an account's kit is still empty.
 */

export type UploadedBrandGuide = {
  voiceTone: string;
  colors: string;
  fonts: string;
  logoAssetsUrl: string;
  dosAndDonts: string;
  senderName: string;
  replyToEmail: string;
  footerNotes: string;
};

const TWELVE_VOLT: UploadedBrandGuide = {
  senderName: "12 Volt Power",
  replyToEmail: "",
  logoAssetsUrl: "",
  voiceTone:
    "A dependable partner, not a vendor. Direct and confident. Reliability first, speed without the rush, and one partner instead of many.",
  colors: "",
  fonts: "",
  dosAndDonts:
    "Say we partner with, not we sell to. Lead with the stakes, then the fix. Fire and first-responder copy can name the community. Marine and commercial copy stays practical and skips the safety drama. Never use shop now, best prices, best-in-class, or a hard sell. Review AI copy before it goes out.",
  footerNotes:
    "Fire and first responder, marine, and commercial. Voice guide for the marketing team and for AI prompts.",
};

const HRIG: UploadedBrandGuide = {
  senderName: "The HR Innovator Group",
  replyToEmail: "",
  logoAssetsUrl: "https://hrinnovatorsgroup.com/",
  voiceTone: "Confident, embedded, systems-minded, collaborative, and direct.",
  colors: "#3A9E3E · #2A7A2E · #111111 · #333333 · #F5F5F5 · #FFFFFF",
  fonts: "Headlines Montserrat Medium. Body is the system sans-serif.",
  dosAndDonts:
    "Tagline is Transforming Workplaces. The offer is the HR & Payroll Pod: a team, not one consultant. We embed. We don't bill hourly, and we don't only advise. Collaborative, not disruptive. Straight answers, not soft HR-speak.",
  footerNotes:
    "Small and growing businesses. Hablamos Español. The mark is stacked green bars with the wordmark in black caps.",
};

const LOODA: UploadedBrandGuide = {
  senderName: "Looda House Pawn",
  replyToEmail: "",
  logoAssetsUrl: "https://loodahousepawn.com",
  voiceTone: "Confident, boutique, knowledgeable, locally rooted, and a little playful.",
  colors: "#000000 · #B8963A · #E1CCBE · #EEEDEB · #FFFFFF",
  fonts: "Headlines Anton, all caps. Body and navigation Roboto. Buttons Epilogue.",
  dosAndDonts:
    "Push back on the dusty-shelf pawn shop. Discretion, expertise, and local swagger. Tagline is Where Treasures Change Hands. The crown and wordmark sit on black.",
  footerNotes:
    "Murrieta, serving the Temecula Valley. Boutique pawn and appraisals. Open 7 days, 8am to 8pm.",
};

const HENDO: UploadedBrandGuide = {
  senderName: "Hendo's Barrel House",
  replyToEmail: "",
  logoAssetsUrl: "",
  voiceTone:
    "The guidelines sheet is the visual system: the starred H, the house, the beer, and the pit.",
  colors:
    "Midnight · Soapstone #F5EEE4 · Walnut · Rust · Leather · Electric Orange #D85338",
  fonts: "Body copy is Proxima Nova. The mark is a condensed display face.",
  dosAndDonts:
    "Use the starred H with HENDO'S BARREL HOUSE around it. Soapstone is #F5EEE4. Electric Orange is #D85338. Midnight, Walnut, Rust, and Leather are named on the sheet.",
  footerNotes: "Brand guidelines sheet, February 2025.",
};

/** The uploaded guide for this account, or null when the name is not one of them. */
export function uploadedBrandGuide(clientName: string): UploadedBrandGuide | null {
  const name = clientName.trim();
  if (/12\s*volt/i.test(name)) return TWELVE_VOLT;
  if (/hr innovator|\bhrig\b/i.test(name)) return HRIG;
  if (/looda/i.test(name)) return LOODA;
  if (/hendo/i.test(name)) return HENDO;
  return null;
}
