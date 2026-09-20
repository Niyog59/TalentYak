# Aafnai — UI Boundaries: Shared Platform vs Fitness

**Module:** M02 · Brand, design system, UX blueprint and basic PWA foundation

This document tells later modules which interface pieces belong to the **Aafnai platform** (usable by any future service) and which belong to **fitness coaching** only. The goal: a second service can be added later without redesigning the product, and without fitness-private data leaking into it.

---

## 1. The rule in one paragraph

Aafnai is the umbrella brand. **Accounts, provider profiles, offers, payments, booking, messaging, notifications, navigation shells and the design system are shared.** **Workout programmes, exercises, workout logs, bodyweight, measurements, progress photos and form videos are fitness-only.** Fitness screens say "coach"; shared server-side code keeps the general word "provider".

---

## 2. Shared platform UI

Any service may use these. None of them contain fitness wording or fitness data.

| Piece | Location | Notes |
|---|---|---|
| Design tokens | `web/src/app/globals.css` | Colours, type, focus, reduced motion. Contrast table in `brand/aafnai/README.md` |
| Logo | `web/src/components/brand/logo.tsx` | Horizontal, stacked, symbol, wordmark; colour, dark, reversed |
| Buttons | `web/src/components/button.tsx` | `primary`, `secondary`, `quiet`, `inverse`, `link`; 44px default height |
| Icons | `web/src/components/ui/icon.tsx` | Always beside a visible label |
| Empty state | `web/src/components/ui/empty-state.tsx` | Honest "nothing here yet" |
| Photo placeholder | `web/src/components/ui/photo-placeholder.tsx` | Until real, consented photography exists |
| Honesty markers | `web/src/components/ui/sample.tsx`, `ui/unavailable.tsx` | `SampleBanner`, `SampleTag`, `SoonTag`, `UnavailableAction` |
| Signed-in shell | `web/src/components/shell/app-shell.tsx` | Sidebar on desktop; ≤5 bottom tabs on phones; More sheet |
| Navigation config | `web/src/components/shell/nav.ts` | One definition per area; base path shared by real and reference routes |
| Public header and footer | `web/src/components/site-nav.tsx`, `site-footer.tsx` | No service chooser while only fitness is public |
| Connection-loss notice | `web/src/components/pwa/connection-status.tsx` | Online-only warning |
| Install help | `web/src/components/pwa/install-help.tsx` | Optional, never auto-prompts |
| Formatting | `web/src/lib/format.ts` | Money always with currency code; times always with a named zone |
| Error and not-found pages | `web/src/app/error.tsx`, `not-found.tsx` | |
| Account page | `web/src/app/(marketing)/account/` | One account for all future services |

### Shared structures with fitness wording today

These are built as fitness screens, but their **structure** generalises. When a second service arrives, extract the structure and keep the wording per service.

| Piece | Location | Generalises to |
|---|---|---|
| Coach card | `web/src/components/fitness/coach-card.tsx` | Provider profile card |
| Plan card with fixed comparison rows | `web/src/components/fitness/plan-card.tsx` | Offer card. Row list is per service; the "same questions, same order, 'Not included' never blank" rule is platform-wide |
| Coach profile page | `web/src/app/preview/(public)/coaches/[slug]/page.tsx` | Provider profile |
| Founder tables | `web/src/app/preview/founder/page.tsx` | All operations tables |

---

## 3. Fitness-only UI

These must never be reused for another service, and their data must never be visible to a provider of another service.

| Piece | Location |
|---|---|
| Workout logger | `web/src/components/fitness/workout-logger.tsx` |
| Weight trend | `web/src/components/fitness/weight-trend.tsx` |
| Quick weight entry | `web/src/components/fitness/quick-weight-entry.tsx` |
| Customer Today, Training, Progress | `web/src/app/preview/customer/` |
| Coach client detail: programme, progress, check-ins, media | `web/src/app/preview/coach/clients/[id]/page.tsx` |
| Public homepage copy and sections | `web/src/components/marketing/homepage.tsx` |

---

## 4. "My services"

**Today:** a customer has at most one service, fitness. The signed-in shell shows a plain **Service: Fitness coaching** label — at the top of the desktop sidebar and inside the phone More sheet. There is **no chooser**, and a customer goes straight to their fitness Today screen.

**Later:** when one account uses more than one service, that same label becomes the **My services** switcher, in the same two places. Each service keeps its own navigation items (`nav.ts` builds one config per area and service).

**Permission boundary — enforced on the server, never in the UI.** Sharing an Aafnai account does not share data between services. A provider of a future service must never be able to read a customer's fitness photos, measurements or workout records. Hiding a navigation item is not access control; row-level security (database rules that decide who can read each row) must carry the boundary, as it already does for fitness tables through `booking_coached_by_me()`.

---

## 5. Public launch gate

Only fitness is public. The gate is on the server, in four places:

1. `PUBLIC_VERTICALS` and `isPublicVertical()` in `web/src/verticals/registry.ts`.
2. `getPublicVerticals()`, `getPublicVertical()`, `getPublicService()` in `web/src/lib/catalog/index.ts`. Public pages use only these.
3. The booking page and the `createBooking` server action refuse any service whose vertical is not public — a direct request fails, not just a hidden link.
4. The retired platform-package catalog URLs (`/services/*`) redirect to `/coaches` (`web/next.config.ts`). The page code is kept.

The sitemap lists only public pages. `robots.txt` disallows private areas and `/preview`. Pandit code, data and founder tools are untouched and stay reachable in `/admin`.

---

## 6. Live vs sample

| | Live routes | Reference screens (`/preview`) |
|---|---|---|
| Data | Real, or an honest empty state | `web/src/lib/sample/fitness.ts` only |
| Marking | None needed | `SampleBanner` on every screen, `SampleTag` on sample people and offers |
| Unbuilt actions | Not shown, or shown as not available | `UnavailableAction` / `SoonTag` |
| Search | Listed if public | `noindex`, disallowed in `robots.txt`, never in the sitemap |

**Live routes must never import `lib/sample/`.** Sample names are deliberately generic ("Sample coach A", "Client C"). No sample biographies or credentials are invented; those areas show what will appear there instead.

**Saving:** no control may say "Saved" before a real save succeeds. The reference workout logger and weight entry validate for real and then say plainly that nothing was saved.

---

## 7. PWA scope in M02

| Capability | State |
|---|---|
| Installable (manifest, icons, standalone display, theme colour, Apple touch icon) | **Built in M02** |
| Connection-loss notice | **Built in M02** |
| Optional install explanation | **Built in M02** |
| Service worker | **None.** M02 deliberately adds no caching |
| Offline pages or data | **None.** Everything needs the internet |
| Safe caching and notification delivery | M08 |
| Offline workout drafts with retry, duplicate prevention and conflict handling | M12 |
| Device installation and update testing | M18 |

Never cache authenticated pages, payment responses, access tokens, signed media links, or private photos and videos.

---

## 8. Route map after M02

| Route | Audience | State |
|---|---|---|
| `/` | Public | Live, honest pre-launch states |
| `/coaches` | Public | Live empty state |
| `/how-it-works`, `/become-a-coach`, `/about` | Public | Live |
| `/account`, `/account/sign-in` | Customer | Live |
| `/services/*` | — | Redirects to `/coaches` |
| `/book/[service]` | Public | Live; public services only; fitness services currently not bookable |
| `/coach/*` | Coach | Live, new shell; only Overview built |
| `/admin/*` | Founder | Live, new shell; all existing tools kept |
| `/preview/*` | Founder review | Reference screens, sample data |
