#!/usr/bin/env node
/**
 * Seeds the "Grand Slam Offers" training course (based on Alex Hormozi's
 * $100M Offers) into the MEG Team Hub → Training section of Campaign Desk.
 *
 * Usage:
 *   node scripts/seed-hormozi-offers.js           # insert / refresh
 *   node scripts/seed-hormozi-offers.js --reset    # same (seed is idempotent)
 *
 * Writes to data/campaign-desk.db (same DB the dev server uses). Re-running
 * wipes the previously-seeded course by slug and rebuilds it cleanly.
 */

const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function id(len = 12) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
const nowIso = () => new Date().toISOString();

const SLUG = "hormozi-100m-offers";

const COURSE = {
  slug: SLUG,
  title: "Grand Slam Offers",
  subtitle:
    "How to make offers so good people feel stupid saying no. Alex Hormozi's $100M Offers, built for the way MEG sells email and marketing.",
  kind: "marketing",
  author: "Alex Hormozi framework",
  summary:
    "Ten lessons on building irresistible offers: pick a starving crowd, price on value, engineer the value equation, then stack it with scarcity, urgency, bonuses, and guarantees. Every lesson ends with how to apply it to client campaigns.",
};

const LESSONS = [
  {
    title: "The Offer Is the Whole Game",
    subtitle: "Why what you sell matters more than how well you sell it.",
    duration: "6 min read",
    body: `An offer is the goods and services you agree to provide, how you accept payment, and the terms of the deal. It is not your logo, your brand, or your clever tagline. It is the thing the customer actually says yes or no to.

Here is the uncomfortable truth. You can be a great marketer with a weak offer and lose. You can be an average marketer with a **Grand Slam Offer** and win big. The offer does the heavy lifting.

## What a Grand Slam Offer is
A Grand Slam Offer is one so good that prospects feel stupid saying no. It combines an attractive promotion, an unmatchable value proposition, a premium price, and an unbeatable guarantee, wrapped with a money model that gets them to say yes.

When your offer is commoditized, you compete on price and you lose margin. When your offer is differentiated, you set the price and you compete with no one.

> If you are having a hard time selling, the problem is usually the offer, not the salesperson.

## The goal: get out of the "commodity" trap
A commodity is a product sold on price. The moment a prospect can compare you head to head with three other options, you are in a price war. The fix is not to shout louder. It is to change what you are selling so there is nothing to compare it to.

## Apply it at MEG
- When a client or prospect hesitates, look at the **offer** first, not the copy. Weak response usually means the deal isn't compelling enough.
- Every campaign we build is really selling an offer. Our job is to make the client's offer feel uncomparable before we ever worry about subject lines.
- Ask on every kickoff: "What is the actual offer here, and why would someone feel stupid saying no to it?"`,
  },
  {
    title: "Find a Starving Crowd",
    subtitle: "The market matters more than the offer, and the offer matters more than the copy.",
    duration: "7 min read",
    body: `Imagine you run a hamburger stand. What is the single biggest advantage you could have? Not the best meat, not the best bun, not the best location. A **starving crowd**. If people are hungry enough, they will forgive almost everything else.

Hormozi ranks the three levers of success in this order:

1. **Market** (the starving crowd)
2. **Offer** (what you sell them)
3. **Persuasion** (the copy and sales skill)

Most people obsess over number three and ignore number one. Pick the wrong market and no offer or copy can save you.

## The four traits of a great market
- **Massive pain.** They desperately want the result. Pain is what makes them buy.
- **Purchasing power.** They can actually afford to pay.
- **Easy to target.** You can find and reach them as a group.
- **Growing.** The market is expanding, not shrinking. A rising tide lifts the boat.

## Pick a niche, then go narrower
Broad markets feel safe but sell soft. The riches are in the niches. "Email marketing" is a commodity. "Lifecycle email for home service businesses that want more booked jobs" is a starving crowd you can speak to directly.

> The more specific the audience, the more they believe your offer was built for them, and the more they will pay.

## Apply it at MEG
- Before optimizing any client's emails, check the segment. Are we mailing a starving crowd or the whole list? Pain + reachability beats volume.
- When helping a client shape their offer, push them toward a narrower "who." Niching down almost always raises response and price.
- For our own agency growth: pick verticals with pain, budget, and growth. Do not chase everyone.`,
  },
  {
    title: "Charge What It's Worth",
    subtitle: "Why raising your price can make the whole offer better.",
    duration: "7 min read",
    body: `Most people price from fear. They discount to feel safe. Hormozi argues the opposite: **premium pricing sets off a virtuous cycle, and discounting sets off a vicious one.**

## The vicious cycle of low prices
Low price means thin margin. Thin margin means no money for great delivery, service, or marketing. Weak delivery means weak results and unhappy clients. Unhappy clients churn, so you chase more low-price clients to survive. Round and round, down.

## The virtuous cycle of premium prices
High price means healthy margin. Healthy margin funds a better product, better service, and better client experience. Better experience means better results, more emotional investment from the client, and more referrals. That justifies the premium and lets you raise it again.

> Higher prices don't just capture more value. They **create** more value, because clients who pay more pay attention and act on what you give them.

## Price and value are not the same thing
Price is what they pay. Value is what they get. Your job is to widen the gap between the two so far that the price becomes irrelevant. You do that by increasing perceived value, not by cutting price.

A client who pays $10k is more committed, more coachable, and gets better results than one who pays $500, even with the identical deliverable. Skin in the game changes behavior.

## Apply it at MEG
- When a client's promo is underperforming, a bigger discount is rarely the answer. Increase the perceived value of the offer instead.
- For our own pricing: charge enough to deliver excellent work. Underpricing quietly starves the quality of everything we ship.
- Teach clients that a premium price, paired with a strong guarantee, often converts better than a cheap price with no risk reversal.`,
  },
  {
    title: "The Value Equation",
    subtitle: "The four variables that decide how much someone wants your offer.",
    duration: "9 min read",
    body: `This is the engine of the entire course. Every buying decision runs through the **Value Equation**. Value goes up when you improve any of these four variables.

## The equation
Value = (**Dream Outcome** × **Perceived Likelihood of Achievement**) ÷ (**Time Delay** × **Effort and Sacrifice**)

The two things on top you want to **increase**. The two on the bottom you want to **decrease**. Push all four the right direction and desire skyrockets.

### 1. Dream Outcome (increase)
The result they truly want and the feeling that comes with it. Sell the "after," not the mechanism. People don't want a drill, they want the hole, and really they want the shelf and how the finished room makes them feel.

### 2. Perceived Likelihood of Achievement (increase)
Do they believe it will work for them? Proof, guarantees, testimonials, case studies, and specificity all raise belief. A high dream outcome with low belief still won't sell.

### 3. Time Delay (decrease)
How long until they see the result. The faster the payoff, the more valuable it feels. Deliver a quick win early even if the full result takes longer. Speed sells.

### 4. Effort and Sacrifice (decrease)
How much work and what they give up to get the result. Done-for-you beats do-it-yourself. Remove steps, reduce friction, and make the path feel easy.

> The best offers maximize the dream and the belief while shrinking the time and the effort to near zero. "Get X result, guaranteed, fast, without doing the hard part."

## How to use it
When an offer feels weak, run it through the four variables and ask which one is dragging it down. Usually one is the bottleneck. Fix that one and the whole offer lifts.

## Apply it at MEG
- Every email we write should push at least one variable: bigger dream, more proof, faster result, or less effort.
- **Subject lines and heroes** usually sell the dream outcome. **Body and testimonials** raise belief. **CTAs** should reduce effort ("we handle the rest").
- Audit a client's offer by scoring all four variables 1 to 10. The lowest score is your next move.`,
  },
  {
    title: "Build the Offer: Problems Into Solutions",
    subtitle: "Divergent thinking to create the raw material of a Grand Slam Offer.",
    duration: "8 min read",
    body: `Now we build. Hormozi's process is a sequence: list the problems, turn them into solutions, decide how to deliver them, then trim and stack. This lesson covers the first half.

## Step 1: List every problem
Start with the prospect's dream outcome, then brainstorm every problem that stands between them and it. Be exhaustive. For each obstacle, they will have it before, during, and after they try. Most offers only solve one problem. A Grand Slam Offer solves the whole set.

For each problem, phrase it as the reason they might fail or hesitate. "I don't have time." "I've tried before and it didn't work." "I won't know what to do next."

## Step 2: Turn each problem into a solution
Flip every problem into the solution that removes it. This is mechanical: restate the problem as the deliverable that solves it.

- Problem: "I don't have time to set it up." → Solution: "Done-for-you setup."
- Problem: "I won't know if it's working." → Solution: "A simple weekly results report."
- Problem: "I'll get stuck." → Solution: "Direct access when you need help."

## Step 3: Think in delivery vehicles
For each solution, ask **how** you could deliver it. Hormozi's "delivery cube" varies things like:
- One-on-one vs one-to-many (group vs private)
- Level of access (email, calls, in person)
- Done for you, done with you, or do it yourself
- Speed and convenience of the help
- The tier of support and the environment around it

You are generating options here, not committing yet. Go wide before you go narrow.

> Divergent thinking creates the raw material. Convergent thinking, in the next lesson, turns it into the actual offer.

## Apply it at MEG
- When shaping a client's offer, run the problem list with them live. Prospects rarely fail for one reason, so the offer should answer several.
- Our deliverables are literally "solutions to problems." Frame each one in a proposal as the obstacle it removes, not as a feature.
- Keep a swipe list of common objections per vertical. Each objection is a problem waiting to become part of the offer.`,
  },
  {
    title: "Trim and Stack Into Value",
    subtitle: "Convergent thinking: keep what's high value and low cost, then present it as a stack.",
    duration: "7 min read",
    body: `You now have a long list of possible solutions and ways to deliver them. If you sold all of it, you would go broke and overwhelm the buyer. Time to converge.

## Score every solution on two axes
For each possible piece of the offer, rate it on:
- **Value to the customer** (high or low)
- **Cost to you to deliver** (high or low)

Then make decisions:
- **High value, low cost:** keep all of these. This is your gold.
- **High value, high cost:** keep the few that matter most, deliver them efficiently.
- **Low value, low cost:** use sparingly as small bonuses.
- **Low value, high cost:** cut these entirely. They drain you and impress no one.

The goal is an offer that feels enormously valuable to the buyer but is efficient for you to fulfill.

## Present it as a stack with a price anchor
Once you know the pieces, present them as a **value stack**. List each component with the standalone value it would carry, sum it up, then reveal a price far below that total.

> When the summed value dwarfs the price, the buyer's brain does the math and the decision makes itself.

The stack works because it makes the value explicit. A vague "coaching program" is hard to value. A named list of eleven concrete deliverables, each with a dollar value, is easy to value, and the total towers over the price.

## Apply it at MEG
- Kill deliverables that are expensive for us and unremarkable to the client. They cost margin and win no love.
- On sales pages and proposal emails, present the offer as a **stack** with itemized value, then anchor the price beneath it.
- The highest-leverage pieces are usually high value to the client and cheap for us to produce at scale. Lead with those.`,
  },
  {
    title: "Enhance With Scarcity",
    subtitle: "Limited supply raises perceived value and prompts action.",
    duration: "6 min read",
    body: `You now have a strong core offer. The next four lessons make it convert harder without changing the deliverable, starting with scarcity.

Scarcity is about **quantity**. When supply is limited, fear of missing out kicks in and perceived value rises. Abundance kills urgency; the moment something is always available, there is no reason to act now.

## Ways to build honest scarcity
- **Limited spots or seats.** "We only take on X new clients per month."
- **Limited quantity of a bonus or tier.** "First 10 get the premium onboarding."
- **Cohort or class size caps.** A real capacity limit that protects quality.
- **Never-again offers.** A specific configuration that won't return in this form.

## The rule: it must be real
Fake scarcity works once, then torches trust. Real scarcity, built into how you actually operate, works forever. Cap things because capacity genuinely matters to quality, then say so plainly.

> The one who cares least in a negotiation has the power. Scarcity flips who is chasing whom.

## Apply it at MEG
- For client promos, use scarcity the client can honestly stand behind: real inventory, real seat counts, real capacity limits.
- Never manufacture a fake "only 3 left" for an unlimited digital product. It burns the list.
- Membership and service businesses can cap monthly intake. That cap is a legitimate, powerful scarcity lever we can build campaigns around.`,
  },
  {
    title: "Enhance With Urgency",
    subtitle: "A deadline turns 'someday' into 'today.'",
    duration: "6 min read",
    body: `Where scarcity is about quantity, **urgency is about time**. It is the deadline that forces a decision. Without it, even people who want your offer will "think about it" forever, and thinking about it is where sales go to die.

## Four clean ways to create urgency
- **Rolling cohorts.** Enrollment opens and closes on a schedule. Miss it, wait for the next start date.
- **Rolling seasonal / promotional deadlines.** A genuine promo that ends on a real date.
- **Pricing or bonus deadlines.** The price goes up or a bonus disappears at a set time.
- **Exploding opportunity.** A real event or window that will pass (a launch, a season, an inventory clearance).

## Why it works
A deadline gives the brain a reason to act now instead of later. Combined with scarcity, it is the one-two punch: limited supply, closing soon.

> Urgency is the difference between an offer people admire and an offer people buy.

## Apply it at MEG
- Every promotional email should carry a real deadline. "Ends Sunday" outperforms "available now" because it removes the option to delay.
- Build campaigns as **sequences** around the deadline: announce, remind, last-chance. The last-chance email is often the top revenue driver.
- Keep deadlines honest. If the offer quietly comes back next week, the list learns to ignore your deadlines.`,
  },
  {
    title: "Enhance With Bonuses",
    subtitle: "Why a stack of bonuses beats a single discount.",
    duration: "7 min read",
    body: `Given the choice between dropping your price and adding bonuses, **add bonuses**. A discount shrinks your value and trains buyers to wait for the next cut. Bonuses grow the perceived value of the deal while protecting your price.

## Why bonuses beat discounts
The price-to-value gap is what drives the purchase. A discount narrows the gap by lowering price. A bonus widens the gap by raising value. Same goal, opposite mechanics, and only one keeps your margin.

## How to present bonuses well
- **Always name and price each bonus.** "Bonus: the 12-month email calendar ($1,500 value)."
- **Sell each bonus** the way you sold the core offer: what it is, why it matters, the result it drives.
- **Solve the next problem.** The best bonuses remove the obstacle the buyer will hit right after they say yes.
- **Use tools and checklists** that reduce effort and time delay, since those are the bottom of the value equation.
- **Stack many small ones.** Several distinct bonuses feel bigger than one large one, because the stack looks longer.
- **Borrow credibility** with bonuses from partners or experts when you can.

> A single item priced at $1,000 feels like a $1,000 thing. Ten items that total $4,000, sold for $1,000, feels like a steal.

## Apply it at MEG
- When a client offer is stalling, propose adding relevant bonuses before you propose discounting. Protect the price, grow the value.
- In emails, present bonuses as a named, itemized stack with dollar values. The visual length of the list does real persuasive work.
- Pick bonuses that solve the buyer's very next problem, so the offer feels like a complete path, not a single product.`,
  },
  {
    title: "Guarantees, and Naming the Offer",
    subtitle: "Reverse the risk, then wrap it in a headline that gets attention.",
    duration: "9 min read",
    body: `The last two enhancers close the deal: a guarantee that removes risk, and a name that earns attention.

## Guarantees reverse the risk
The number one thing stopping a purchase is the fear of loss: "What if I pay and it doesn't work?" A strong guarantee shifts that risk from the buyer back to you. Counterintuitively, a bolder guarantee usually **increases** net profit, because the lift in conversions outweighs the refunds.

### Four families of guarantee
- **Unconditional.** "Money back, no questions asked." The strongest and simplest.
- **Conditional.** "Do the work, and if you don't get X, we keep going free / you get your money back." Ties the guarantee to action.
- **Anti-guarantee.** "All sales final," used when the offer or price makes refunds inappropriate. Rare, but honest.
- **Implied / performance.** "We only win when you win," often a revenue-share or results-based structure.

The best guarantees are **specific and bold**: name the result, name the timeframe, name what you'll do if it doesn't happen. Vague guarantees reassure no one.

> A guarantee doesn't just reduce risk. It signals that **you** believe in the offer, which raises the prospect's belief too.

## Name it with M-A-G-I-C
An unnamed offer is invisible. Hormozi's headline formula assembles attention-grabbing names from these ingredients:

- **M — Magnetic reason why.** Give a believable reason for the offer ("End of summer", "New location").
- **A — Announce the avatar.** Call out exactly who it's for ("Attention home service owners").
- **G — Give them a goal.** State the dream outcome ("book 30 more jobs").
- **I — Indicate a time interval.** Put a timeframe on it ("in 90 days").
- **C — Complete with a container word.** Package it as a thing ("Challenge", "Blueprint", "Accelerator", "Intensive").

You don't need all five, but the more you weave in, the more magnetic the name.

## Putting the whole thing together
A finished Grand Slam Offer reads like this: the right **market**, a core offer built by turning **problems into solutions**, **trimmed and stacked** for value, priced at a **premium**, enhanced with **scarcity, urgency, bonuses, and a bold guarantee**, and wrapped in a **named** headline that stops the scroll.

## Apply it at MEG
- Push every client to add a specific, bold guarantee where their business model allows. It is often the single biggest conversion lever in the offer.
- Name the offer and use that name across the whole campaign. A named offer is easier to remember, refer, and sell.
- Use MAGIC to write promo names and subject lines: who it's for, the goal, the timeframe, and a container word. That formula alone will sharpen most of our campaigns.`,
  },
];

// One quiz per lesson (same order as LESSONS). answer is the 0-based index of
// the correct option. Kept separate from the lesson bodies for readability.
const QUIZZES = [
  // 1. The Offer Is the Whole Game
  [
    {
      prompt: "What is an \"offer\" in Hormozi's sense?",
      options: [
        "Your logo, brand, and tagline",
        "The goods/services, how you take payment, and the terms",
        "The subject line and copy of an email",
        "A temporary discount you run",
      ],
      answer: 1,
      explanation: "The offer is the actual thing a prospect says yes or no to: what they get, how they pay, and the terms. Not branding or copy.",
    },
    {
      prompt: "A Grand Slam Offer is best described as one that…",
      options: [
        "Is the cheapest option in the market",
        "Wins on a great salesperson alone",
        "Is so good prospects feel stupid saying no",
        "Looks identical to competitors",
      ],
      answer: 2,
      explanation: "A Grand Slam Offer is so differentiated and valuable that saying no feels foolish, so you stop competing on price.",
    },
  ],
  // 2. Find a Starving Crowd
  [
    {
      prompt: "Hormozi ranks these three from most to least important as:",
      options: [
        "Persuasion > Offer > Market",
        "Offer > Market > Persuasion",
        "Market > Offer > Persuasion",
        "They matter equally",
      ],
      answer: 2,
      explanation: "Market beats offer, and offer beats persuasion. Pick the wrong starving crowd and no copy can save you.",
    },
    {
      prompt: "Which is NOT one of the four traits of a great market?",
      options: [
        "Massive pain",
        "Purchasing power",
        "A low price point",
        "Easy to target",
      ],
      answer: 2,
      explanation: "The four traits are pain, purchasing power, easy to target, and growing. Price point isn't one of them.",
    },
  ],
  // 3. Charge What It's Worth
  [
    {
      prompt: "Why can a premium price create more value, not just capture it?",
      options: [
        "Higher margin funds better delivery, and committed clients act more",
        "Because customers ignore expensive products",
        "It lowers your cost of fulfillment",
        "It has no effect on value",
      ],
      answer: 0,
      explanation: "Premium pricing funds a better experience and clients who pay more stay engaged and get better results: the virtuous cycle.",
    },
    {
      prompt: "A client promo is underperforming. Hormozi's instinct is to…",
      options: [
        "Cut the price further",
        "Increase the perceived value of the offer",
        "Email the list more often",
        "Shorten the deadline",
      ],
      answer: 1,
      explanation: "Widen the gap between price and value by raising value, rather than discounting into the vicious cycle.",
    },
  ],
  // 4. The Value Equation
  [
    {
      prompt: "In the Value Equation, which two variables do you want to DECREASE?",
      options: [
        "Dream Outcome and Perceived Likelihood",
        "Time Delay and Effort & Sacrifice",
        "Price and Margin",
        "Scarcity and Urgency",
      ],
      answer: 1,
      explanation: "Value = (Dream Outcome × Perceived Likelihood) ÷ (Time Delay × Effort & Sacrifice). Shrink the bottom two.",
    },
    {
      prompt: "Adding testimonials and case studies mainly improves which variable?",
      options: [
        "Time Delay",
        "Effort & Sacrifice",
        "Perceived Likelihood of Achievement",
        "Dream Outcome",
      ],
      answer: 2,
      explanation: "Proof raises belief that it will work for them, which is Perceived Likelihood of Achievement.",
    },
  ],
  // 5. Build the Offer: Problems Into Solutions
  [
    {
      prompt: "What is the first step in building the offer?",
      options: [
        "Set the price",
        "List every problem between the prospect and their dream outcome",
        "Write the guarantee",
        "Name the offer",
      ],
      answer: 1,
      explanation: "Start by exhaustively listing the obstacles, then turn each into a solution.",
    },
    {
      prompt: "The \"delivery cube\" is about deciding…",
      options: [
        "How much to discount",
        "How each solution could be delivered (group vs 1:1, DFY vs DIY, access, speed)",
        "Which market to pick",
        "When the offer expires",
      ],
      answer: 1,
      explanation: "It varies the how of delivery: one-to-many vs one-on-one, done-for-you vs DIY, level of access, speed, and support.",
    },
  ],
  // 6. Trim and Stack Into Value
  [
    {
      prompt: "Which quadrant of solutions should you cut entirely?",
      options: [
        "High value, low cost",
        "High value, high cost",
        "Low value, high cost",
        "Low value, low cost",
      ],
      answer: 2,
      explanation: "Low value to the customer and high cost to you drains margin and impresses no one. Cut it.",
    },
    {
      prompt: "Why present the offer as a value stack with a price anchor?",
      options: [
        "It hides what's included",
        "The summed value dwarfs the price, so the decision makes itself",
        "It lets you charge less",
        "It removes the need for a guarantee",
      ],
      answer: 1,
      explanation: "Itemizing value makes it explicit; when the total towers over the price, the math sells the offer.",
    },
  ],
  // 7. Enhance With Scarcity
  [
    {
      prompt: "Scarcity is fundamentally about…",
      options: ["Time", "Quantity", "Price", "Effort"],
      answer: 1,
      explanation: "Scarcity limits quantity (spots, seats, units). Urgency is the one about time.",
    },
    {
      prompt: "The non-negotiable rule for scarcity is that it must be…",
      options: [
        "Hidden from the customer",
        "Real",
        "Applied only to digital products",
        "Combined with a discount",
      ],
      answer: 1,
      explanation: "Fake scarcity works once then destroys trust. Real, capacity-based limits work forever.",
    },
  ],
  // 8. Enhance With Urgency
  [
    {
      prompt: "How does urgency differ from scarcity?",
      options: [
        "Urgency is about time; scarcity is about quantity",
        "They're the same thing",
        "Urgency lowers the price",
        "Urgency is about quantity; scarcity is about time",
      ],
      answer: 0,
      explanation: "Urgency is the deadline (time); scarcity is limited supply (quantity). Together they're the one-two punch.",
    },
    {
      prompt: "In a promo email sequence, which send is often the top revenue driver?",
      options: [
        "The first announcement",
        "The mid-sequence educational email",
        "The last-chance / deadline email",
        "The welcome email",
      ],
      answer: 2,
      explanation: "The last-chance email removes the option to delay, so it frequently drives the most conversions.",
    },
  ],
  // 9. Enhance With Bonuses
  [
    {
      prompt: "Given the choice, Hormozi says to…",
      options: [
        "Drop the price rather than add bonuses",
        "Add bonuses rather than drop the price",
        "Always do both at once",
        "Remove the guarantee to save money",
      ],
      answer: 1,
      explanation: "Bonuses widen the price-to-value gap and protect margin; discounts shrink value and train buyers to wait.",
    },
    {
      prompt: "What makes a bonus most effective?",
      options: [
        "Leaving it unnamed and unpriced",
        "Solving the buyer's very next problem, named with a dollar value",
        "Making it identical to the core offer",
        "Hiding it until after purchase",
      ],
      answer: 1,
      explanation: "Name and price each bonus, and have it solve the next obstacle so the offer feels like a complete path.",
    },
  ],
  // 10. Guarantees, and Naming the Offer
  [
    {
      prompt: "Why can a bolder guarantee increase net profit?",
      options: [
        "Because refunds are impossible",
        "The lift in conversions outweighs the extra refunds",
        "It lets you raise the price to infinity",
        "It removes the need for an offer",
      ],
      answer: 1,
      explanation: "Reversing risk lifts conversions enough that the added sales more than cover the refunds, and it signals your own belief.",
    },
    {
      prompt: "In the M-A-G-I-C naming formula, the \"C\" stands for…",
      options: [
        "Cut the price",
        "Complete with a container word (Challenge, Blueprint, Intensive)",
        "Call the customer",
        "Create urgency",
      ],
      answer: 1,
      explanation: "MAGIC = Magnetic reason why, Announce the avatar, Give a goal, Indicate a time interval, Complete with a container word.",
    },
  ],
];

function main() {
  const dbPath = path.join(process.cwd(), "data", "campaign-desk.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Ensure tables exist even if the app hasn't created them yet.
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'marketing',
      author TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS course_lessons (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      duration TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_course ON course_lessons(course_id);
    CREATE TABLE IF NOT EXISTS course_quiz_questions (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      correct_index INTEGER NOT NULL DEFAULT 0,
      explanation TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lesson_id) REFERENCES course_lessons(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_lesson ON course_quiz_questions(lesson_id);
  `);

  const wipe = db.prepare(`DELETE FROM courses WHERE slug = ?`).run(SLUG);
  if (wipe.changes > 0) console.log(`Removed existing "${SLUG}" course (cascades lessons).`);

  const ts = nowIso();
  const courseId = id();
  db.prepare(
    `INSERT INTO courses (id, slug, title, subtitle, kind, author, summary, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(courseId, COURSE.slug, COURSE.title, COURSE.subtitle, COURSE.kind, COURSE.author, COURSE.summary, 0, ts, ts);

  const insLesson = db.prepare(
    `INSERT INTO course_lessons (id, course_id, title, subtitle, body, duration, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insQuiz = db.prepare(
    `INSERT INTO course_quiz_questions (id, lesson_id, prompt, options, correct_index, explanation, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let quizCount = 0;
  LESSONS.forEach((l, i) => {
    const lessonId = id();
    insLesson.run(lessonId, courseId, l.title, l.subtitle, l.body, l.duration, i, ts, ts);
    const quiz = QUIZZES[i] || [];
    quiz.forEach((q, qi) => {
      const opts = Array.isArray(q.options) ? q.options : [];
      const answer = Math.max(0, Math.min(opts.length - 1, Number(q.answer) || 0));
      insQuiz.run(id(), lessonId, q.prompt, JSON.stringify(opts), answer, q.explanation || "", qi, ts, ts);
      quizCount++;
    });
  });

  db.close();
  console.log(`Seeded course "${COURSE.title}" with ${LESSONS.length} lessons and ${quizCount} quiz questions.`);
  console.log(`View it at /admin/courses/${SLUG} (MEG Team Hub → Training).`);
}

main();
