// Built-in form templates

type TemplateQuestion = {
  label: string;
  type: string;
  required: boolean;
  options?: { value: string; label: string }[];
  settings?: Record<string, unknown>;
};

type Template = {
  id: string;
  name: string;
  description: string;
  category: string;
  questions: TemplateQuestion[];
};

export const TEMPLATES: Template[] = [
  {
    id: "student-feedback",
    name: "Student Feedback",
    description: "Collect student feedback on courses, events, or faculty.",
    category: "Education",
    questions: [
      { label: "Full Name", type: "SHORT_TEXT", required: true },
      { label: "Department", type: "SHORT_TEXT", required: true },
      { label: "Semester", type: "SHORT_TEXT", required: true },
      {
        label: "Overall Experience",
        type: "RATING",
        required: true,
        settings: { min: 1, max: 5 },
      },
      { label: "What did you enjoy most?", type: "LONG_TEXT", required: false },
      { label: "What could be improved?", type: "LONG_TEXT", required: false },
      {
        label: "Would you recommend this?",
        type: "YES_NO",
        required: true,
      },
    ],
  },
  {
    id: "event-registration",
    name: "Event Registration",
    description: "Register attendees for college events, workshops, or seminars.",
    category: "Events",
    questions: [
      { label: "Full Name", type: "SHORT_TEXT", required: true },
      { label: "Email Address", type: "EMAIL", required: true },
      { label: "Phone Number", type: "SHORT_TEXT", required: true },
      { label: "Department / Branch", type: "SHORT_TEXT", required: true },
      { label: "Year of Study", type: "SHORT_TEXT", required: true },
      {
        label: "How did you hear about this event?",
        type: "SINGLE_CHOICE",
        required: false,
        options: [
          { value: "friends", label: "Friends" },
          { value: "social_media", label: "Social Media" },
          { value: "college_notice", label: "College Notice Board" },
          { value: "teacher", label: "Teacher" },
          { value: "other", label: "Other" },
        ],
      },
    ],
  },
  {
    id: "workshop-registration",
    name: "Workshop Registration",
    description: "Sign up participants for technical or creative workshops.",
    category: "Events",
    questions: [
      { label: "Full Name", type: "SHORT_TEXT", required: true },
      { label: "Email", type: "EMAIL", required: true },
      { label: "Department", type: "SHORT_TEXT", required: true },
      {
        label: "Experience Level",
        type: "SINGLE_CHOICE",
        required: true,
        options: [
          { value: "beginner", label: "Beginner" },
          { value: "intermediate", label: "Intermediate" },
          { value: "advanced", label: "Advanced" },
        ],
      },
      { label: "What do you hope to learn?", type: "LONG_TEXT", required: false },
      {
        label: "Do you have a laptop?",
        type: "YES_NO",
        required: true,
      },
    ],
  },
  {
    id: "teacher-feedback",
    name: "Teacher Feedback",
    description: "Collect anonymous feedback about teaching quality.",
    category: "Education",
    questions: [
      { label: "Subject / Course", type: "SHORT_TEXT", required: true },
      {
        label: "Teaching Quality",
        type: "RATING",
        required: true,
        settings: { min: 1, max: 5 },
      },
      {
        label: "Communication",
        type: "RATING",
        required: true,
        settings: { min: 1, max: 5 },
      },
      {
        label: "Punctuality",
        type: "RATING",
        required: true,
        settings: { min: 1, max: 5 },
      },
      { label: "Strengths", type: "LONG_TEXT", required: false },
      { label: "Areas for Improvement", type: "LONG_TEXT", required: false },
    ],
  },
  {
    id: "attendance",
    name: "Attendance",
    description: "Quick attendance collection for classes or events.",
    category: "Education",
    questions: [
      { label: "Full Name", type: "SHORT_TEXT", required: true },
      { label: "Roll Number", type: "SHORT_TEXT", required: true },
      { label: "Date", type: "DATE", required: true },
    ],
  },
  {
    id: "general-survey",
    name: "General Survey",
    description: "A blank survey template with common question types.",
    category: "General",
    questions: [
      { label: "Name", type: "SHORT_TEXT", required: false },
      {
        label: "Satisfaction",
        type: "RATING",
        required: true,
        settings: { min: 1, max: 5 },
      },
      { label: "Comments or Suggestions", type: "LONG_TEXT", required: false },
    ],
  },
];
