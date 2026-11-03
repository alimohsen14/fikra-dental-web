// The text a patient receives. Fixed wording; only the clinic name, patient, doctor and time change.

export interface ConfirmationInput {
  clinicName: string;
  patientName: string;
  doctorName: string;
  startsAt: Date;
  timeZone: string;
}

/** "د. علي" whether the stored name already starts with a title or not. */
export function doctorLabel(fullName: string): string {
  const bare = fullName.trim().replace(/^(د\.?|دكتور|الدكتور)\s+/u, '');
  return `د. ${bare}`;
}

export function confirmationText(i: ConfirmationInput): string {
  const day = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: i.timeZone }).format(i.startsAt);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: i.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(i.startsAt);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: i.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(i.startsAt);
  return [
    `مرحباً ${i.patientName.trim()}،`,
    `عيادة ${i.clinicName.trim()} بتذكّرك بموعدك مع ${doctorLabel(i.doctorName)}:`,
    `📅 ${day} ${date}`,
    `🕐 ${time}`,
    '',
    'للتأكيد ردّ بكلمة: نعم',
    'للإلغاء ردّ بكلمة: لا',
    '',
    'شكراً لك 🌷',
  ].join('\n');
}

/** What a patient may answer. Anything else is ignored (a human reads it later). */
export function parseAnswer(text: string): 'YES' | 'NO' | null {
  const t = text.trim().replace(/[ً-ْـ]/gu, '').replace(/[!.،؟?\s]+$/u, '');
  if (['نعم', 'ايوه', 'أيوه', 'اه', 'آه', 'اي', 'أكيد', 'تمام', 'yes', 'y', 'ok', '1'].includes(t.toLowerCase())) return 'YES';
  if (['لا', 'لأ', 'no', 'n', '2'].includes(t.toLowerCase())) return 'NO';
  return null;
}
