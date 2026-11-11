import { confirmationText, doctorLabel, parseAnswer } from './message-text.js';

describe('confirmation text', () => {
  const base = { clinicName: 'عيادة النور', patientName: ' محمد مسيمي ', doctorName: 'علي المحسن', startsAt: new Date('2026-11-03T08:30:00Z'), timeZone: 'Asia/Hebron' };
  it('is the approved wording with the clinic, patient, doctor, day, date and local time', () => {
    const t = confirmationText({ ...base, clinicName: 'النور' });
    expect(t).toBe(
      ['مرحباً محمد مسيمي،', 'تذكّرك عيادة النور بموعدك مع د. علي المحسن:', '📅 الثلاثاء 2026-11-03', '🕐 10:30', '', 'للتأكيد ردّ بكلمة: نعم', 'للإلغاء ردّ بكلمة: لا', '', 'شكراً لك 🌷'].join('\n'),
    );
  });
  it('uses the clinic time zone, not the server one', () => {
    expect(confirmationText({ ...base, timeZone: 'UTC' })).toContain('🕐 08:30');
  });
  it('does not double a doctor title', () => {
    expect(doctorLabel('علي')).toBe('د. علي');
    expect(doctorLabel('د. علي')).toBe('د. علي');
    expect(doctorLabel('دكتور علي')).toBe('د. علي');
    expect(doctorLabel('الدكتور علي')).toBe('د. علي');
  });
});

describe('what the patient answers', () => {
  it('yes and no in the common ways', () => {
    for (const y of ['نعم', ' نعم ', 'نعم!', 'ايوه', 'أيوه', 'اه', 'Yes', 'ok', '1']) expect(parseAnswer(y)).toBe('YES');
    expect(parseAnswer('١')).toBe('YES');
    expect(parseAnswer('٢')).toBe('NO');
    for (const n of ['لا', 'لا.', 'لأ', 'No', '2']) expect(parseAnswer(n)).toBe('NO');
  });
  it('anything else is not an answer', () => {
    for (const x of ['', 'ممكن أغير الموعد؟', 'لا اله الا الله', 'نعمين', '3']) expect(parseAnswer(x)).toBeNull();
  });
});
