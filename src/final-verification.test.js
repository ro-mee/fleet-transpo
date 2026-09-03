import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET as getAnalytics } from "./app/api/analytics/expenses/route";
import { POST as postExpense } from "./app/api/mobile/expenses/route";
import { POST as assignCard } from "./app/api/cards/[id]/assignments/route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import crypto from "crypto";

describe("FINAL VERIFICATION AUDIT", () => {
  let adminAuthSpy;
  let driverAuthSpy;

  beforeEach(async () => {
    // Clear out test tables completely so we have a sterile environment
    await db.query(`DELETE FROM expense_records`);
    await db.query(`DELETE FROM expense_receipt_scans`);
    await db.query(`DELETE FROM company_card_assignments`);
    await db.query(`DELETE FROM company_cards`);
    
    // We need real drivers. Just mock the auth to return driverId = 1 and employeeId = 1
    adminAuthSpy = vi.spyOn(utils, "requireAuth").mockResolvedValue({
      user: { role: "admin", employeeId: 1 },
    });
    driverAuthSpy = vi.spyOn(utils, "requireDriver").mockResolvedValue({
      user: { driverId: 1, employeeId: 1 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockRequest(body) {
    return { json: async () => body };
  }

  it("1. ANALYTICS FINANCIAL INVARIANT", async () => {
    // Insert Pending, Rejected, Approved
    const baseFields = `client_submission_id, driver_id, amount, currency, expense_date, category, payment_method, receipt_storage_key, receipt_sha256, submitted_at, receipt_uploaded_at, ocr_snapshot`;
    const baseVals = (amt) => `gen_random_uuid(), 1, ${amt}, 'PHP', '2026-09-15', 'Toll', 'Cash', 'key', 'hash', 'now()', 'now()', '{}'`;
    
    await db.query(`INSERT INTO expense_records (${baseFields}, status) VALUES (${baseVals(100)}, 'Pending')`);
    await db.query(`INSERT INTO expense_records (${baseFields}, status) VALUES (${baseVals(200)}, 'Rejected')`);
    await db.query(`INSERT INTO expense_records (${baseFields}, status) VALUES (${baseVals(300)}, 'Approved')`);

    const res = await getAnalytics({});
    const json = await res.json();
    
    expect(res.status).toBe(200);
    // Expected total is 300
    expect(json.total_approved).toBe(300);
    
    // Verify changing Pending to Approved changes analytics
    await db.query(`UPDATE expense_records SET status = 'Approved' WHERE status = 'Pending'`);
    const res2 = await getAnalytics({});
    const json2 = await res2.json();
    expect(json2.total_approved).toBe(400); // 300 + 100
  });

  it("2. TIMEZONE BOUNDARY", async () => {
    // Sept 30 23:59 Asia/Manila (15:59 UTC)
    // Oct 1 00:01 Asia/Manila (16:01 UTC)
    const baseFields = `client_submission_id, driver_id, amount, currency, category, payment_method, receipt_storage_key, receipt_sha256, status, submitted_at, receipt_uploaded_at, ocr_snapshot`;
    
    await db.query(`INSERT INTO expense_records (${baseFields}, expense_date) VALUES (gen_random_uuid(), 1, 100, 'PHP', 'Toll', 'Cash', 'k1', 'h1', 'Approved', 'now()', 'now()', '{}', '2026-09-30 15:59:00+00')`);
    await db.query(`INSERT INTO expense_records (${baseFields}, expense_date) VALUES (gen_random_uuid(), 1, 200, 'PHP', 'Toll', 'Cash', 'k2', 'h2', 'Approved', 'now()', 'now()', '{}', '2026-09-30 16:01:00+00')`);

    const res = await getAnalytics({});
    const json = await res.json();
    
    const sept = json.monthly_breakdown.find(m => m.month === '2026-09');
    const oct = json.monthly_breakdown.find(m => m.month === '2026-10');
    
    expect(sept.total_amount).toBe("100.00");
    expect(oct.total_amount).toBe("200.00");
  });

  it("3. CONCURRENCY: CARD ASSIGNMENTS", async () => {
    const { rows: card } = await db.query(`INSERT INTO company_cards (card_last_four, provider, status) VALUES ('1234', 'Visa', 'Active') RETURNING id`);
    const cardId = card[0].id;
    
    // Simulate 3 concurrent assignment requests for the same card
    const req1 = mockRequest({ employee_id: 1, assignment_type: 'Assigned' });
    const req2 = mockRequest({ employee_id: 2, assignment_type: 'Assigned' });
    const req3 = mockRequest({ employee_id: 3, assignment_type: 'Assigned' });
    
    const res = await Promise.allSettled([
      assignCard(req1, { params: { id: cardId } }),
      assignCard(req2, { params: { id: cardId } }),
      assignCard(req3, { params: { id: cardId } })
    ]);
    
    // Verify only 1 active assignment exists
    const { rows: active } = await db.query(`SELECT id FROM company_card_assignments WHERE company_card_id = $1 AND unassigned_at IS NULL`, [cardId]);
    expect(active.length).toBe(1);
    
    // Total assignments should be 3 (2 closed, 1 active)
    const { rows: total } = await db.query(`SELECT id FROM company_card_assignments WHERE company_card_id = $1`, [cardId]);
    expect(total.length).toBe(3);
  });

  it("4. CROSS-DRIVER DUPLICATES", async () => {
    // Insert scan records so we bypass the missing scan errors
    const sub1 = crypto.randomUUID();
    const sub2 = crypto.randomUUID();
    const sub3 = crypto.randomUUID();
    
    await db.query(`INSERT INTO expense_receipt_scans (client_submission_id, driver_id, receipt_storage_key, receipt_sha256, ocr_snapshot) VALUES ($1, 1, 'k1', 'SHARED_HASH', '{}')`, [sub1]);
    await db.query(`INSERT INTO expense_receipt_scans (client_submission_id, driver_id, receipt_storage_key, receipt_sha256, ocr_snapshot) VALUES ($1, 2, 'k2', 'SHARED_HASH', '{}')`, [sub2]);
    await db.query(`INSERT INTO expense_receipt_scans (client_submission_id, driver_id, receipt_storage_key, receipt_sha256, ocr_snapshot) VALUES ($1, 2, 'k3', 'DIFF_HASH', '{}')`, [sub3]);

    // Driver 1 creates expense
    driverAuthSpy.mockResolvedValue({ user: { driverId: 1, employeeId: 1 } });
    await postExpense(mockRequest({
      client_submission_id: sub1, category: 'Toll', merchant_name: 'Test', amount: 100, currency: 'PHP', expense_date: '2026-09-01', payment_method: 'Cash'
    }));

    // Driver 2 submits identical hash (DUP-05)
    driverAuthSpy.mockResolvedValue({ user: { driverId: 2, employeeId: 2 } });
    const res2 = await postExpense(mockRequest({
      client_submission_id: sub2, category: 'Toll', merchant_name: 'Test', amount: 100, currency: 'PHP', expense_date: '2026-09-01', payment_method: 'Cash'
    }));
    const json2 = await res2.json();
    expect(json2.flags.DUPLICATE_RECEIPT_HASH).toBe(true);

    // Driver 2 submits different hash, but same merchant/amount/date (DUP-06)
    const res3 = await postExpense(mockRequest({
      client_submission_id: sub3, category: 'Toll', merchant_name: 'Test', amount: 100, currency: 'PHP', expense_date: '2026-09-01', payment_method: 'Cash'
    }));
    const json3 = await res3.json();
    expect(json3.flags.CROSS_DRIVER_SIMILAR_EXPENSE).toBe(true);
    expect(json3.flags.DUPLICATE_RECEIPT_HASH).toBeUndefined();
    expect(res3.status).toBe(201); // NOT hard rejected
  });

  it("5. INPUT VALIDATION", async () => {
    const body = { client_submission_id: crypto.randomUUID(), category: 'Toll', merchant_name: 'Test', amount: 100, currency: 'PHP', expense_date: '2026-09-01', payment_method: 'Cash' };
    
    // Test negative amount
    let res = await postExpense(mockRequest({ ...body, amount: -100 }));
    expect(res.status).toBe(400);

    // Test invalid currency (lowercase)
    res = await postExpense(mockRequest({ ...body, currency: 'php' }));
    expect(res.status).toBe(400);
    
    // Test 4+ char currency
    res = await postExpense(mockRequest({ ...body, currency: 'PESO' }));
    expect(res.status).toBe(400);

    // Test malformed UUID (returns 400, not 500)
    res = await postExpense(mockRequest({ ...body, client_submission_id: 'invalid-uuid-123' }));
    expect(res.status).toBe(400);
    
    // Test missing required field (expense_date)
    res = await postExpense(mockRequest({ ...body, expense_date: undefined }));
    expect(res.status).toBe(400);
  });
});
