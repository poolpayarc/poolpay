import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { POOLPAY_ADDRESS, POOLPAY_VIEW_ADDRESS, USDC_ADDRESS } from "../config/contracts";
import { Wordmark } from "../components/ui";
import { Reveal } from "../components/motion";
import {
  ArrowRight,
  BookOpen,
  Droplets,
  FileCode2,
  HandCoins,
  Landmark,
  PiggyBank,
  Percent,
  ShieldCheck,
  Sparkles,
  Users,
  Vote,
} from "lucide-react";

const FAUCET_URL = "https://faucet.circle.com";
const EXPLORER_URL = "https://testnet.arcscan.app";
const CHAIN_ID = 5042002;
const ARCSCAN_URL = `${EXPLORER_URL}/address/${POOLPAY_ADDRESS}`;

const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-navy font-semibold text-white shadow-sm transition-all duration-200 hover:bg-navy-hover hover:shadow-lg hover:shadow-navy/25 active:scale-[0.98]";

const NAV = [
  { id: "what-is-poolpay", label: "What is PoolPay?", icon: BookOpen },
  { id: "creating-a-pool", label: "Creating a Pool", icon: Users },
  { id: "monthly-deposits", label: "Monthly Deposits", icon: PiggyBank },
  { id: "borrowing", label: "Borrowing", icon: HandCoins },
  { id: "how-2-percent-works", label: "How the 2% works", icon: Percent },
  { id: "voting", label: "Voting", icon: Vote },
  { id: "repayment-yield", label: "Repayment & Interest", icon: Landmark },
  { id: "year-end-settlement", label: "Year-End Settlement", icon: Sparkles },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "contract-addresses", label: "Smart Contract Addresses", icon: FileCode2 },
];

const ADDRESSES: { label: string; value: string; href?: string }[] = [
  { label: "PoolPay", value: POOLPAY_ADDRESS, href: `${EXPLORER_URL}/address/${POOLPAY_ADDRESS}` },
  {
    label: "PoolPayView",
    value: POOLPAY_VIEW_ADDRESS,
    href: `${EXPLORER_URL}/address/${POOLPAY_VIEW_ADDRESS}`,
  },
  { label: "Network", value: `Arc Testnet (Chain ID: ${CHAIN_ID})` },
  { label: "USDC", value: USDC_ADDRESS, href: `${EXPLORER_URL}/address/${USDC_ADDRESS}` },
  { label: "Explorer", value: EXPLORER_URL, href: EXPLORER_URL },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Reveal>
      <section id={id} className="scroll-mt-28 border-l-2 border-navy py-12 pl-6">
        <h2 className="text-2xl font-bold text-navy">{title}</h2>
        <div className="mt-4 space-y-4 text-base leading-relaxed text-body">{children}</div>
      </section>
    </Reveal>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 marker:text-navy">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white text-ink">
      {/* Header (same as landing page) */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-hairline bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" aria-label="PoolPay home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-3 sm:gap-6">
            <Link
              to="/docs"
              className="hidden text-sm font-medium text-ink transition hover:text-ink sm:block"
            >
              Docs
            </Link>
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className="pp-underline hidden items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-navy sm:inline-flex"
            >
              <Droplets className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              Faucet
            </a>
            <Link to="/app" className={`${btnPrimary} px-5 py-2.5 text-sm`}>
              Launch App
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-32">
        <div className="lg:flex lg:gap-16">
          {/* Sidebar */}
          <aside className="hidden lg:block lg:w-56 lg:shrink-0">
            <nav className="sticky top-28 space-y-1">
              <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-faint">
                Documentation
              </p>
              {NAV.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-navy"
                >
                  <n.icon className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
                  {n.label}
                </a>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <main className="min-w-0 flex-1">
            <div className="max-w-3xl">
              <p className="text-sm font-medium text-navy">Documentation</p>
              <h1 className="mt-2 text-4xl font-bold tracking-tight text-navy">PoolPay Docs</h1>
              <p className="mt-4 text-lg leading-relaxed text-muted">
                Everything you need to know about group savings and lending on Arc Network.
              </p>

              <div className="mt-6">
                <Section id="what-is-poolpay" title="What is PoolPay?">
                  <p>
                    PoolPay is a decentralized group savings and lending protocol on Arc Network.
                    Inspired by traditional mandali and chit fund systems used across India and South
                    Asia, it brings these trusted community savings models onchain. Groups of 2–10
                    people create shared USDC pools, contribute monthly, and provide loans to members
                    with transparent, fixed-rate interest. No banks, no middlemen ,the smart contract
                    handles everything.
                  </p>
                </Section>

                <Section id="creating-a-pool" title="Creating a Pool">
                  <p>Any user can create a pool by connecting their wallet and setting:</p>
                  <Bullets
                    items={[
                      "Pool name (up to 31 characters)",
                      "Monthly contribution amount in USDC",
                      "Duration: 6 or 12 months",
                      "Member wallet addresses (2–10 members including creator)",
                    ]}
                  />
                  <p>
                    Borrowing costs a fixed 2% per month on the borrowed amount ,the same for every pool, and deposits themselves earn nothing. Once created, the pool is
                    live onchain and all members can begin depositing.
                  </p>
                </Section>

                <Section id="monthly-deposits" title="Monthly Deposits">
                  <p>
                    Each member deposits their fixed contribution amount every month. The pool
                    dashboard shows real-time deposit status ,who has deposited for the current month
                    and who hasn&apos;t. You can only deposit once per month, and only for the current
                    month. Each deposit costs approximately $0.02 in gas on Arc Network.
                  </p>
                </Section>

                <Section id="borrowing" title="Borrowing from the Pool">
                  <p>
                    Any pool member can request to borrow USDC from the pool&apos;s available balance.
                    When creating a borrow request, you specify:
                  </p>
                  <Bullets
                    items={[
                      "Amount to borrow",
                      "Repayment duration (1–6 months)",
                      "Recipient wallet address",
                    ]}
                  />
                  <p>
                    The system auto-generates an invoice showing the exact repayment: principal +
                    interest. Example: borrowing $700 for 3 months at 2%/month = $742 total ($700
                    principal + $42 interest). This invoice is visible to all members before they vote.
                  </p>
                </Section>

                <Section id="how-2-percent-works" title="How the 2% Works">
                  <p>
                    The 2% is monthly interest a borrower pays on the amount they borrow ,nothing
                    more. It is not a rate on savings, and the pool does not pay members to deposit.
                  </p>
                  <Bullets
                    items={[
                      "Borrow $400 for 1 month → repay $408 ($400 + $8 interest).",
                      "Borrow $400 for 3 months → repay $424 ($400 + $24 interest).",
                    ]}
                  />
                  <p>
                    Savings deposits do not earn interest on their own. Interest only exists when a
                    member borrows and repays. When a loan is repaid, that interest is shared among
                    members ,it is the only money the pool ever generates.
                  </p>
                </Section>

                <Section id="voting" title="Voting on Loans">
                  <p>
                    All pool members except the borrower vote on each loan request. A majority of
                    eligible voters must approve for the loan to go through. Once approved, funds
                    transfer immediately to the recipient. If not enough votes are cast within 7 days,
                    the request automatically expires. Each member can only vote once per request.
                  </p>
                </Section>

                <Section id="repayment-yield" title="Repayment & Interest">
                  <p>
                    Borrowers repay the full amount (principal + interest) by the due date. When a loan
                    is repaid, that interest is distributed proportionally among all members based on
                    their net positive balance ,members who have saved more in the pool receive a
                    larger share. Savers only earn when someone actually borrows and repays: no
                    borrowing means no interest, and there is no guaranteed return.
                  </p>
                </Section>

                <Section id="year-end-settlement" title="Year-End Settlement">
                  <p>
                    When the pool&apos;s duration ends, all outstanding loans must be repaid first. Once
                    all loans are settled, any member can trigger the pool closure. Each member receives
                    their remaining deposits plus any interest earned throughout the pool&apos;s lifetime.
                    The smart contract calculates everything automatically ,transparent, fair, and
                    verifiable.
                  </p>
                </Section>

                <Section id="security" title="Security">
                  <p>
                    PoolPay is fully non-custodial. Funds are held by the smart contract on Arc
                    Network, not by any company or individual. All transactions are transparent and
                    verifiable on ArcScan. Key security features:
                  </p>
                  <Bullets
                    items={[
                      "No admin controls ,once a pool is created, no single person has special privileges",
                      "USDC-based ,stable value, no volatile token risk",
                      "Open source ,the smart contract code is verifiable",
                      "Members can leave a pool and withdraw their balance at any time (if no outstanding debt)",
                    ]}
                  />
                </Section>

                <Section id="contract-addresses" title="Smart Contract Addresses">
                  <p>All PoolPay contracts are deployed and verifiable on Arc Testnet.</p>
                  <div className="overflow-x-auto rounded-xl border border-hairline bg-surface p-4 font-mono text-sm">
                    <div className="space-y-2">
                      {ADDRESSES.map((a) => (
                        <div key={a.label} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                          <span className="w-28 shrink-0 text-muted">{a.label}</span>
                          {a.href ? (
                            <a
                              href={a.href}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-navy hover:underline"
                            >
                              {a.value}
                            </a>
                          ) : (
                            <span className="break-all text-ink">{a.value}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted sm:flex-row">
          <div className="flex items-center gap-2.5">
            <Wordmark markCls="h-7 w-7" textCls="text-base" />
            <span>© 2026</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/docs" className="transition hover:text-ink">
              Docs
            </Link>
            <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="transition hover:text-ink">
              Faucet
            </a>
            <a href={ARCSCAN_URL} target="_blank" rel="noreferrer" className="transition hover:text-ink">
              ArcScan
            </a>
          </div>
          <div>Built on Arc Network</div>
          <span><a href="https://x.com/Kriyeto" target="_blank" rel="noopener noreferrer" className="hover:text-[#3e52f3] transition">Built by @Kriyeto</a></span>
        </div>
      </footer>
    </div>
  );
}
