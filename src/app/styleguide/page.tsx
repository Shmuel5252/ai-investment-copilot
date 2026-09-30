import { notFound } from "next/navigation";
import { Num } from "@/components/num";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Badge, EvidenceTierBadge, EVIDENCE_TIERS } from "@/components/ui/badge";
import { Status, Notice } from "@/components/ui/status";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { Table, THead, TBody, Tr, Th, Td, KeyValues } from "@/components/ui/table";
import { EmptyState, Skeleton, LoadingText, ErrorState, HelpText } from "@/components/ui/states";

// DEVELOPMENT ONLY. The living style guide of the shared primitives, with
// SYNTHETIC placeholder data only (PRODUCT.md: the investor's real figures
// never appear in design work). Not in the navigation; a 404 in
// production. The next redesign units read this page to reuse, not to
// reinvent.
export const dynamic = "force-static";

const DEMO_ROWS = [
  { ticker: "ABCD", type: "קנייה", date: "12.03.2026", size: "$4,200", change: "+3.4%" },
  { ticker: "EFGH", type: "הפחתה", date: "28.02.2026", size: "$1,150", change: "-1.8%" },
  { ticker: "IJKL", type: "דילוג", date: "14.02.2026", size: "—", change: "—" },
] as const;

export default function StyleguidePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main>
      <PageShell>
        <PageHeader
          title="מדריך סגנון"
          description="הרכיבים המשותפים של Frontend V1, עם נתוני דוגמה בלבד. כל יחידת עיצוב הבאה משתמשת ברכיבים האלה במקום להמציא אותם מחדש."
          meta={
            <>
              עודכן <Num>30.09.2026</Num> · סביבת פיתוח בלבד
            </>
          }
          actions={
            <>
              <ButtonLink href="/styleguide/journal" variant="quiet">
                יומן לדוגמה
              </ButtonLink>
              <ButtonLink href="/styleguide/strategy" variant="quiet">
                אסטרטגיה לדוגמה
              </ButtonLink>
              <ButtonLink href="/styleguide/dna" variant="quiet">
                DNA לדוגמה
              </ButtonLink>
              <ButtonLink href="/styleguide/ideas" variant="quiet">
                רעיונות לדוגמה
              </ButtonLink>
              <ButtonLink href="/styleguide/decision" variant="quiet">
                החלטה לדוגמה
              </ButtonLink>
              <ButtonLink href="/styleguide/case" variant="quiet">
                תיק מחקר לדוגמה
              </ButtonLink>
              <ButtonLink href="/styleguide/home" variant="quiet">
                תצוגת סקירה לדוגמה
              </ButtonLink>
              <Button variant="secondary">פעולה משנית</Button>
              <Button variant="primary">פעולה ראשית</Button>
            </>
          }
        />

        <Section id="type" title="טיפוגרפיה" hint="כותרת עמוד אחת בסריף; כל השאר ב-Assistant. ספרות טבלאיות למספרים כספיים.">
          <Card>
            <div className="flex flex-col gap-3">
              <p className="font-serif text-2xl font-bold">כותרת עמוד — Frank Ruhl Libre</p>
              <p className="text-base font-semibold">כותרת מקטע — 16px semibold</p>
              <p className="text-sm">
                טקסט גוף — 15px. הרעיון עצמו נשאר במילים של המשקיע; המערכת רק מסדרת אותו. מחיר בכניסה <Num>$182.40</Num>, שינוי{" "}
                <Num>-0.85%</Num>, תאריך <Num>12.03.2026</Num> — כולם עוברים דרך <bdi dir="ltr">&lt;Num&gt;</bdi>.
              </p>
              <p className="text-xs text-muted">טקסט משני — 12px, מודגש בצבע muted ועדיין 4.5:1.</p>
              <p className="num text-sm">
                <bdi dir="ltr">1,234.56 · 98.10 · 12,000.00</bdi> — ספרות טבלאיות מיישרות עמודות מספרים.
              </p>
            </div>
          </Card>
        </Section>

        <Section id="evidence" title="מצבי ראיות" hint="Evidence Strength הוא מצב מוצרי, לא שגיאה. הערך מחושב בקוד; כאן רק המראה וההסבר.">
          <div className="grid gap-3 md:grid-cols-2">
            {EVIDENCE_TIERS.map((tier) => (
              <Card key={tier} padding="sm">
                <EvidenceTierBadge tier={tier} showHint />
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {EVIDENCE_TIERS.map((tier) => (
              <EvidenceTierBadge key={tier} tier={tier} />
            ))}
            <EvidenceTierBadge tier={null} />
          </div>
        </Section>

        <Section id="status" title="סטטוס ותגיות">
          <Card>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone="neutral">ניטרלי</Badge>
                <Badge tone="info">מידע</Badge>
                <Badge tone="positive">תומך</Badge>
                <Badge tone="caution">דורש תשומת לב</Badge>
                <Badge tone="negative">סותר</Badge>
              </div>
              <div className="flex flex-wrap gap-5">
                <Status tone="positive">אושרה</Status>
                <Status tone="caution">ממתינה</Status>
                <Status tone="negative">הופרכה</Status>
                <Status tone="neutral">לא חד-משמעית</Status>
              </div>
              <Notice tone="info" title="הקשר מאוחר">
                הקשר שנוסף בדיעבד נשמר כתוספת, לעולם לא כעריכה של ההחלטה המקורית.
              </Notice>
              <Notice tone="caution">לפני שממשיכים: לשתי עסקאות באותו יום אין סדר מוצהר.</Notice>
            </div>
          </Card>
        </Section>

        <Section id="buttons" title="כפתורים">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">ראשי</Button>
              <Button variant="secondary">משני</Button>
              <Button variant="quiet">שקט</Button>
              <Button variant="danger">מחיקה</Button>
              <Button variant="primary" loading>
                ראשי
              </Button>
              <Button variant="secondary" disabled>
                מושבת
              </Button>
              <Button size="sm">קטן</Button>
              <ButtonLink href="/styleguide" variant="quiet" size="sm">
                קישור ככפתור
              </ButtonLink>
            </div>
          </Card>
        </Section>

        <Section id="forms" title="שדות טופס">
          <Card>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="טיקר" required help="אותיות לטיניות בלבד, כפי שמופיע בבורסה.">
                {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} dir="ltr" placeholder="ABCD" />}
              </Field>
              <Field label="גודל פוזיציה" error="חייב להיות מספר חיובי.">
                {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} dir="ltr" defaultValue="-100" />}
              </Field>
              <Field label="סוג החלטה">
                {({ id, describedBy, invalid }) => (
                  <Select id={id} aria-describedby={describedBy} invalid={invalid} defaultValue="BUY">
                    <option value="BUY">קנייה</option>
                    <option value="HOLD">החזקה</option>
                    <option value="PASS">דילוג</option>
                  </Select>
                )}
              </Field>
              <Field label="נימוק" help="במילים שלך. הטקסט נשמר כפי שנכתב ולא מתורגם." className="md:col-span-2">
                {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} placeholder="למה עכשיו, ומה יגרום לך לשנות את דעתך?" />}
              </Field>
            </div>
          </Card>
        </Section>

        <Section id="tables" title="טבלאות ורשומות" count={DEMO_ROWS.length}>
          <Table caption="נתוני דוגמה. עמודות מספריות מיושרות לקצה ומשתמשות בספרות טבלאיות.">
            <THead>
              <Tr>
                <Th>טיקר</Th>
                <Th>סוג</Th>
                <Th numeric>תאריך</Th>
                <Th numeric>גודל</Th>
                <Th numeric>שינוי</Th>
              </Tr>
            </THead>
            <TBody>
              {DEMO_ROWS.map((r) => (
                <Tr key={r.ticker}>
                  <Td>
                    <Num>{r.ticker}</Num>
                  </Td>
                  <Td>{r.type}</Td>
                  <Td numeric muted>
                    <Num>{r.date}</Num>
                  </Td>
                  <Td numeric>
                    <Num>{r.size}</Num>
                  </Td>
                  <Td numeric className={r.change.startsWith("-") ? "text-negative" : r.change.startsWith("+") ? "text-positive" : "text-muted"}>
                    <Num>{r.change}</Num>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Card>
            <KeyValues
              items={[
                { label: "מזומן", value: <Num>$8,500</Num> },
                { label: "עלות ממוצעת", value: <Num>$96.20</Num> },
                { label: "נוצר", value: <Num>03.01.2026</Num> },
                { label: "מצב", value: <Status tone="info">בתהליך מחקר</Status> },
              ]}
            />
          </Card>
        </Section>

        <Section id="states" title="מצבי ריק, טעינה ושגיאה">
          <div className="grid gap-4 md:grid-cols-3">
            <EmptyState title="עוד אין תיקי מחקר" action={<Button variant="primary" size="sm">רעיון חדש</Button>}>
              תיק מחקר נפתח מרעיון שאתה מקליד בעצמך. המערכת לא מציעה רעיונות מעצמה.
            </EmptyState>
            <Card padding="sm">
              <Skeleton lines={4} />
              <LoadingText className="mt-3" />
            </Card>
            <ErrorState message="TRPCClientError: Failed to fetch" />
          </div>
          <HelpText>
            טקסט הסבר: כל מספר שמוצג כאן מחושב בקוד מהעסקאות שיובאו. הוא לא הערכה של המערכת ולא תחזית.
          </HelpText>
        </Section>
      </PageShell>
    </main>
  );
}
