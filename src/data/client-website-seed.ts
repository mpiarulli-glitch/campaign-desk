// Researched public sites for Campaign Desk clients whose rev_clients.website
// was blank in production. The seed fills a blank website only. Names that
// were left on initials on purpose are not in this list: Milan and Associates,
// My 401k PEP Solution, Looda House Auction, News & Views Podcast, Orangecrest
// Club, Continental Villages, American Made Blue Collar LLC, 27th Street
// Bakery, Paychex Empire Partnership, Curt's Floor Covering, Maya's
// Construction, Best U.

export type ClientWebsiteSeedEntry = {
  name: string;
  domain: string;
  /**
   * Desk name when normalizeClientMatchKey cannot fold it onto `name`.
   * Used only if `name` itself does not match a client.
   */
  also?: readonly string[];
};

export const CLIENT_WEBSITE_SEED: readonly ClientWebsiteSeedEntry[] = [
  { name: "Trinity Hub", domain: "trinityhub.ai" },
  { name: "Luxurious Heating and Air Conditioning", domain: "luxurioushvacinc.com" },
  { name: "Coronas De Oro", domain: "coronas-deoro.com" },
  { name: "Dolce Vita Wellness Spa", domain: "dolcevitawellnessspa.com" },
  { name: "FloorCo Design", domain: "floorcodesign.com" },
  { name: "Swing Inn Cafe & BBQ", domain: "swinginncafe.com" },
  { name: "Krak Boba Corporate", domain: "krakboba.com" },
  { name: "Krak Boba Piscataway", domain: "krakboba.com" },
  { name: "Krak Boba Oceanside", domain: "krakboba.com" },
  { name: "Krak Boba Temecula", domain: "krakboba.com" },
  { name: "Stephanie's Construction", domain: "stephaniesconstructioninc.com" },
  { name: "NORLO Peptides", domain: "norlopeptides.com" },
  { name: "Cuidando De Ti Advantage", domain: "cuidandodetiadvantage.com" },
  { name: "Black's Shutters Shades & Blinds", domain: "blacksblinds.com" },
  { name: "1off Creative Concepts", domain: "1offcc.com" },
  { name: "ALL-IN-1 Construction", domain: "allinone-const.com" },
  { name: "JG Seamless Gutters", domain: "jgseamlessgutters.com" },
  { name: "Looda House Pawn", domain: "loodahousepawn.com" },
  { name: "Our Watch w/Tim Thompson", domain: "ourwatch.com" },
  { name: "Vitatherapy Wellness & Medspa", domain: "vitatherapybykatie.com" },
  { name: "Hendo's Barrel House", domain: "hendosbarrelhouse.com" },
  { name: "The HR Innovator Group", domain: "hrinnovatorsgroup.com" },
  { name: "Kentina", domain: "kentinahospitality.com" },
  { name: "Chaparral Junk Removal", domain: "chaparraljunkremoval.com" },
  { name: "Housecleaning by Christina", domain: "cleaningbychristina.com" },
  { name: "12 Volt Power", domain: "12voltpower.com" },
  { name: "DH Construction", domain: "dhfirerestoration.com" },
  { name: "Pacific Coast Generation", domain: "pacificcoastgeneration.com" },
  { name: "Inland Valley Chiropractic", domain: "inlandvalleychiropractic.com" },
  { name: "Trailhead Family Chiropractic", domain: "trailheadchiropractic.com" },
  { name: "A Tac Exterminators", domain: "tacexterminators.com" },
  { name: "Passion Life Church", domain: "passionlifechurch.com" },
  { name: "Law Offices of Giselle Rodriguez, PC", domain: "gisellerlaw.com" },
  { name: "The BetterLife Coach", domain: "betterlifecourse.com" },
  { name: "BLuu Construction", domain: "bluuconstruction.com" },
  { name: "S.K. Produce Co.", domain: "skproduce.com" },
  { name: "Premier Choice Management", domain: "premierchoicemanagement.com" },
  { name: "Ecoworkz", domain: "ecoworkz.net" },
  { name: "Pristine Clean", domain: "pristinecleansolutions.com" },
  { name: "MBros Pool Construction", domain: "mbrospoolconstruction.com" },
  { name: "CIPO Cloud Software", domain: "ciposoftware.com" },
  { name: "Alliance Tops", domain: "alliancetops.com" },
  { name: "Pipe It Right", domain: "pipeitrightrepipe.com" },
  { name: "Danza Del Sol", domain: "danzadelsolwinery.com" },
  { name: "CISCo Restaurant + Bar", domain: "ciscorestaurantbar.com" },
  {
    name: "GenEX Cleaning Services (Azteca Cleaning)",
    domain: "aztecacleaningservices.com",
    also: ["GenX Cleaning Services"],
  },
  {
    name: "Beyond the Walls Community Church",
    domain: "beyondthewallschurch.org",
    also: ["Beyond The Walls Church"],
  },
  { name: "Scott Cole Plumbing", domain: "scottcoleplumbing.com" },
  { name: "Guardian Plumbers, Heating, Air & Electrical", domain: "guardianplumbers.com" },
  { name: "Amazing Tile Stone", domain: "amazingtilestone.com" },
  { name: "Integrity Air", domain: "iateaminc.com" },
  { name: "Superior Patios", domain: "superiorpatios.com" },
  { name: "Bear Windows", domain: "bearwindows.com" },
  { name: "Top Notch Auto", domain: "topnotch-auto.com" },
];
