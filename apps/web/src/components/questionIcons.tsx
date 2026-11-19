import type { ReactNode } from "react";
import type { QuestionType } from "../types";

type IconProps = { size?: number };

function Svg({ size = 18, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ShortTextIcon(p: IconProps) {
  return <Svg {...p}><path d="M4 8h16M4 16h10" /></Svg>;
}
export function ParagraphIcon(p: IconProps) {
  return <Svg {...p}><path d="M4 6h16M4 11h16M4 16h16M4 21h9" /></Svg>;
}
export function EmailIcon(p: IconProps) {
  return <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Svg>;
}
export function NumberIcon(p: IconProps) {
  return <Svg {...p}><path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" /></Svg>;
}
export function DateIcon(p: IconProps) {
  return <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>;
}
export function RadioIcon(p: IconProps) {
  return <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" /></Svg>;
}
export function CheckboxIcon(p: IconProps) {
  return <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" /></Svg>;
}
export function RatingIcon(p: IconProps) {
  return <Svg {...p}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></Svg>;
}
export function YesNoIcon(p: IconProps) {
  return <Svg {...p}><path d="m5 12 4 4 10-10" /></Svg>;
}
export function PhoneIcon(p: IconProps) {
  return <Svg {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></Svg>;
}
export function LinkIcon(p: IconProps) {
  return <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></Svg>;
}
export function UploadIcon(p: IconProps) {
  return <Svg {...p}><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></Svg>;
}
export function SignatureIcon(p: IconProps) {
  return <Svg {...p}><path d="M3 17c3 0 4-9 6-9s0 9 3 9 2-5 4-5 1 3 3 3M3 21h18" /></Svg>;
}
export function ScaleIcon(p: IconProps) {
  return <Svg {...p}><path d="M3 12h18M6 8v8M12 8v8M18 8v8" /></Svg>;
}
export function MultiEntryIcon(p: IconProps) {
  return <Svg {...p}><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /></Svg>;
}
export function InviteIcon(p: IconProps) {
  return <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" /></Svg>;
}
export function LockIcon(p: IconProps) {
  return <Svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
}
export function UnlockIcon(p: IconProps) {
  return <Svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></Svg>;
}
export function ClockIcon(p: IconProps) {
  return <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
}
export function GridIcon(p: IconProps) {
  return <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></Svg>;
}
export function CheckGridIcon(p: IconProps) {
  return <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16M7 8l1.5 1.5L11 6.5" /></Svg>;
}
export function TextBlockIcon(p: IconProps) {
  return <Svg {...p}><path d="M5 5h14M12 5v14M9 19h6" /></Svg>;
}
export function ImageIcon(p: IconProps) {
  return <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></Svg>;
}
export function PlusIcon(p: IconProps) {
  return <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Svg>;
}
export function SectionIcon(p: IconProps) {
  return <Svg {...p}><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /></Svg>;
}
export function DuplicateIcon(p: IconProps) {
  return <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Svg>;
}
export function TrashIcon(p: IconProps) {
  return <Svg {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Svg>;
}
export function KebabIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </Svg>
  );
}
export function CaretIcon(p: IconProps) {
  return <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
}
export function GripIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={Math.round((size * 12) / 20)} viewBox="0 0 20 12" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <circle cx="5" cy="2" r="1.5" /><circle cx="10" cy="2" r="1.5" /><circle cx="15" cy="2" r="1.5" />
        <circle cx="5" cy="9" r="1.5" /><circle cx="10" cy="9" r="1.5" /><circle cx="15" cy="9" r="1.5" />
      </g>
    </svg>
  );
}

export function QuestionTypeIcon({ type, size }: { type: QuestionType; size?: number }) {
  switch (type) {
    case "SHORT_TEXT": return <ShortTextIcon size={size} />;
    case "LONG_TEXT": return <ParagraphIcon size={size} />;
    case "EMAIL": return <EmailIcon size={size} />;
    case "NUMBER": return <NumberIcon size={size} />;
    case "DATE": return <DateIcon size={size} />;
    case "SINGLE_CHOICE": return <RadioIcon size={size} />;
    case "MULTIPLE_CHOICE": return <CheckboxIcon size={size} />;
    case "RATING": return <RatingIcon size={size} />;
    case "YES_NO": return <YesNoIcon size={size} />;
    case "PHONE": return <PhoneIcon size={size} />;
    case "URL": return <LinkIcon size={size} />;
    case "FILE_UPLOAD": return <UploadIcon size={size} />;
    case "SIGNATURE": return <SignatureIcon size={size} />;
    case "LINEAR_SCALE": return <ScaleIcon size={size} />;
    case "MULTI_ENTRY": return <MultiEntryIcon size={size} />;
    case "TIME": return <ClockIcon size={size} />;
    case "MULTIPLE_CHOICE_GRID": return <GridIcon size={size} />;
    case "CHECKBOX_GRID": return <CheckGridIcon size={size} />;
    case "TEXT_BLOCK": return <TextBlockIcon size={size} />;
    case "IMAGE_BLOCK": return <ImageIcon size={size} />;
  }
}
