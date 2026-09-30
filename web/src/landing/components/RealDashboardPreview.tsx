import { useEffect, useState } from 'react';
import { Dashboard } from '../../pages/Dashboard';
import { CompanyProvider } from '../../auth/CompanyContext';
import { DEMO_CO } from '../data';

export function RealDashboardPreview() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = input.toString();
      
      if (url.includes('/dashboard/overview')) {
        return new Response(JSON.stringify({
          profile: {
            id: 'demo-123',
            legalName: DEMO_CO.legalName,
            entityType: 'COMPANY',
            registrationNumber: DEMO_CO.cin,
            registrationLabel: 'CIN',
            incorporationDate: '2023-02-17',
            pan: DEMO_CO.pan,
            gstins: [{ gstin: '29AAACA4821P1Z5', stateCode: '29', isActive: true }],
            msme: { udyamNumber: 'UDYAM-KR-00-1234567' },
            dpiit: null,
            dsc: { status: 'ACTIVE', active: 2, total: 2 },
            mcaKyc: { status: 'MET', periodLabel: 'FY 2025-26', dueDate: '2026-09-30' },
            epfoCode: 'MH/BAN/1234567/000',
            esicCode: '31001234560001001',
            directors: [
              { id: '1', name: 'Ramesh Kumar', designation: 'Director', din: '01234567', dscStatus: 'ACTIVE', dscExpiresOn: '2027-01-01', dinStatus: { state: 'ACTIVE', label: 'Approved', action: null, derived: false, asOfPeriod: null } },
              { id: '2', name: 'Priya Sharma', designation: 'Director', din: '09876543', dscStatus: 'ACTIVE', dscExpiresOn: '2027-01-01', dinStatus: { state: 'ACTIVE', label: 'Approved', action: null, derived: false, asOfPeriod: null } }
            ]
          },
          score: { 
            score: 92, band: 'A', assessed: 14, onTime: 13, late: 0, 
            dueInNext30Days: 3, preOnboarding: 0, missed: 0, waived: 0, upcoming: 3, overdueNow: 0,
            windowStart: '2026-04-01', windowEnd: '2027-03-31',
            byAuthority: [
              { authority: 'MCA', earned: 100, possible: 100, score: 100, onTime: 2, late: 0, missed: 0 },
              { authority: 'GST', earned: 90, possible: 100, score: 90, onTime: 5, late: 0, missed: 0 },
              { authority: 'INCOME_TAX', earned: 100, possible: 100, score: 100, onTime: 6, late: 0, missed: 0 }
            ]
          },
          companies: 1,
          statusCounts: { OVERDUE: 0, DUE: 1, UPCOMING: 2, COMPLETED: 11, WAIVED: 0 },
          severityCounts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
          byAuthority: [
            { authority: 'MCA', total: 2, overdue: 0, completed: 2, upcoming: 0 },
            { authority: 'GST', total: 6, overdue: 0, completed: 5, upcoming: 1 },
            { authority: 'INCOME_TAX', total: 6, overdue: 0, completed: 4, upcoming: 2 }
          ],
          overdue: [],
          dueSoon: [
            { id: '1', title: 'File DIR-3 KYC', authority: 'MCA', severity: 'HIGH', status: 'UPCOMING', dueOn: '2026-09-30' },
            { id: '2', title: 'GSTR-3B', authority: 'GST', severity: 'MEDIUM', status: 'DUE', dueOn: '2026-09-20' }
          ],
          taskCounts: { open: 3, completed: 11 },
          evidence: { coveragePct: 85, itemsWithEvidence: 12, itemsRequiringEvidence: 14 },
          registrations: [
            { id: 'mca_cin', status: 'REGISTERED' },
            { id: 'pan', status: 'REGISTERED' },
            { id: 'gst', status: 'REGISTERED' },
            { id: 'msme', status: 'REGISTERED' },
            { id: 'pf', status: 'NOT_REQUIRED' },
            { id: 'esi', status: 'NOT_REQUIRED' }
          ]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.includes('/documents')) {
        return new Response(JSON.stringify({ rows: [
          { id: 'doc1', companyId: 'demo-123', fileName: 'pan.pdf', label: 'pan', createdAt: '2026-01-01' },
          { id: 'doc2', companyId: 'demo-123', fileName: 'gst.pdf', label: 'gst', createdAt: '2026-01-01' },
          { id: 'doc3', companyId: 'demo-123', fileName: 'msme.pdf', label: 'msme', createdAt: '2026-01-01' }
        ] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.includes('/companies')) {
        return new Response(JSON.stringify([{ id: 'demo-123', legalName: DEMO_CO.legalName, entityType: 'COMPANY', isActive: true, myCapabilities: ['READ'] }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      return originalFetch(input, init);
    };

    setReady(true);
    return () => { window.fetch = originalFetch; };
  }, []);

  if (!ready) return null;

  return (
    <div className="lp-real-dash-wrapper">
      <div className="lp-real-dash-glass">
        <CompanyProvider>
          <div className="lp-real-dash-scale">
            <div className="lp-real-dash-content" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
              <Dashboard />
            </div>
          </div>
        </CompanyProvider>
      </div>
    </div>
  );
}
