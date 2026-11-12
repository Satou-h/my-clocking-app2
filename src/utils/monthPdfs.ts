/**
 * monthPdfs.ts — 月の書類のPDFを作る（ダウンロード画面と、提出画面の「PDFで確認」で共有）
 *
 * ・いま開いているデータ（自分、またはリーダー・管理者が開いたメンバー）の書類を作る
 * ・勤務表は、提出用の勤務表と、時間の内訳を細かく載せた勤務表(計算用)の2件を作る
 * ・確認済み・承認済みの書類は、確認の欄（勤務表: 確認印 / 休暇・遅刻早退申請書: 確認 / 交通費精算書: 検印）に
 *   確認した人の印鑑を押す。承認済みの書類は、承認欄に承認した人の印鑑も押す（未提出・確認前なら空）
 * ・作ったPDFは保存せずに返す（保存するか画面に表示するかは呼び出す側が決める）
 */
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { LEAVE_LABELS, calcLeaveDays } from '../types/application';
import type { DocKey } from '../types/document';
import { loadUserProfile, loadSkillEntries, loadCertifications, loadWorkHistory } from './storage';
import { buildMonthDocs } from './monthDocs';
import { printMonthlyAttendancePDF } from './attendancePdf';
import { printWorkReport } from './pdf';
import { printLeaveApplication, printLateEarlyApplication } from './applicationPdf';
import { printTransportPDF } from './transportPdf';
import { printSkillSheet, printWorkHistory } from './skillPdf';
import { collectPdfs } from './pdfOutput';
import { sortWorkHistory } from './workHistory';
import { loadSummary } from './workReport';
import { approverOf, confirmerOf, getSubmissionState } from './submissions';

export interface MonthPdfSource {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
}

// year 年 month 月の docs の書類のPDFを作る（休暇申請書・遅早退申請書は申請ごとに1件）
export function makeMonthPdfs(
  year: number, month: number, docs: Iterable<DocKey>,
  { records, transportRecords, workSettings, paidLeaveSettings }: MonthPdfSource,
): Promise<File[]> {
  const targets = new Set(docs);
  const p = loadUserProfile();
  const {
    monthPrefix, leaveApplications, lateEarlyApplications, reportName, plRemaining, reportWeeks, skillProfile, skillName,
  } = buildMonthDocs(year, month, records, transportRecords, workSettings, paidLeaveSettings);

  const subs = getSubmissionState().items;
  const approver = (doc: DocKey) => approverOf(subs, doc, year, month);
  const confirmer = (doc: DocKey) => confirmerOf(subs, doc, year, month);

  return collectPdfs(async () => {
    if (targets.has('attendance')) {
      await printMonthlyAttendancePDF(
        records, workSettings, year, month, plRemaining, p.employeeId, p.lastName, reportName,
        approver('attendance'), confirmer('attendance'),
      );
    }

    if (targets.has('transport')) {
      await printTransportPDF(
        transportRecords, year, month, p.employeeId, p.lastName, reportName, approver('transport'), confirmer('transport'),
      );
    }

    if (targets.has('leave')) {
      const batches = leaveApplications.filter((b) => b.dateEntries.some((e) => e.date.startsWith(monthPrefix)));
      for (const batch of batches) {
        const entriesInMonth = batch.dateEntries.filter((e) => e.date.startsWith(monthPrefix));
        await printLeaveApplication({
          applicationDate: batch.applicationDate,
          name: batch.name,
          dateEntries: entriesInMonth.map((e) => ({ date: e.date, leaveLabel: LEAVE_LABELS[e.leaveType] })),
          leaveDays: calcLeaveDays(entriesInMonth),
          reason: batch.reason,
        }, p.employeeId, p.lastName, approver('leave'), confirmer('leave'));
      }
    }

    if (targets.has('lateEarly')) {
      const apps = lateEarlyApplications.filter((r) => r.targetDate.startsWith(monthPrefix));
      for (const rec of apps) {
        await printLateEarlyApplication({
          applicationDate: rec.applicationDate,
          name: rec.name,
          type: rec.type,
          targetDate: rec.targetDate,
          scheduledTime: rec.scheduledTime,
          actualTime: rec.actualTime,
          reason: rec.reason,
        }, p.employeeId, p.lastName, approver('lateEarly'), confirmer('lateEarly'));
      }
    }

    if (targets.has('workReport')) {
      await printWorkReport(year, month, reportName, reportWeeks, p.employeeId, p.lastName, loadSummary(year, month));
    }

    if (targets.has('skillSheet')) {
      await printSkillSheet({ ...skillProfile, name: skillName }, loadSkillEntries(), loadCertifications(), p.employeeId, p.lastName);
    }

    if (targets.has('workHistory')) {
      await printWorkHistory(skillName, sortWorkHistory(loadWorkHistory()), p.employeeId, p.lastName);
    }
  });
}
