# Requirements Document

## Introduction

This specification defines the UI/UX redesign of the Qivo Forms platform, covering both the form editor experience and the respondent-facing form. The redesign is inspired by Google Forms' design principles: progressive disclosure, focused editing through active card states, autosave, and a clean centered workspace layout. The goal is to transform the existing functional but basic editor into a polished, efficient editing experience while maintaining all current functionality (13 question types, conditional logic, quiz mode, drag-and-drop, approval workflow, version history).

## Glossary

- **Editor**: The Qivo Forms form editor interface used by form creators to build and configure forms
- **Respondent_View**: The public-facing form interface where respondents fill out and submit forms
- **Top_Nav**: The persistent horizontal navigation bar at the top of the Editor containing branding, form title, save status, and action buttons
- **Workspace_Tabs**: The tab navigation component (Builder, Responses, Settings) below the Top_Nav that switches between Editor views
- **Form_Canvas**: The central content area of the Builder tab where form header and question cards are displayed
- **Question_Card**: A UI component representing a single question in the Form_Canvas, with active and inactive visual states
- **Active_Card**: A Question_Card that is currently selected/focused, showing all editing controls
- **Inactive_Card**: A Question_Card that is not selected, showing only essential information (label, type badge)
- **Floating_Toolbar**: A vertically-oriented toolbar fixed to the right side of the Form_Canvas providing quick-add actions
- **Save_Status_Indicator**: A visual element in the Top_Nav displaying the current save state (Saved, Saving…, Offline, Error)
- **Progress_Indicator**: A visual element in the Respondent_View showing completion progress through multi-section forms
- **Progressive_Disclosure**: A design pattern where advanced or secondary controls are hidden until needed, reducing visual clutter

## Requirements

### Requirement 1: Editor Top Navigation Bar

**User Story:** As a form creator, I want a persistent top navigation bar with key actions always visible, so that I can quickly access form identity, save status, and common actions without scrolling.

#### Acceptance Criteria

1. THE Top_Nav SHALL display the Qivo logo (linking to dashboard), an inline-editable form title, the Save_Status_Indicator, undo button, redo button, preview button, share button, and publish button in a single horizontal bar
2. WHEN a form creator clicks the form title in the Top_Nav, THE Editor SHALL transform the title into an editable text input with the current title pre-filled
3. WHEN a form creator presses Enter or blurs the title input, THE Editor SHALL save the updated title and return to display mode
4. THE Top_Nav SHALL remain fixed at the top of the viewport while the form creator scrolls the Form_Canvas
5. WHEN the viewport width is less than 768 pixels, THE Top_Nav SHALL collapse secondary actions (share, publish) into an overflow menu

### Requirement 2: Workspace Tabs Navigation

**User Story:** As a form creator, I want tabbed navigation between Builder, Responses, and Settings views, so that I can switch contexts without leaving the editor.

#### Acceptance Criteria

1. THE Editor SHALL display Workspace_Tabs with three options: Builder, Responses, and Settings, positioned below the Top_Nav
2. WHEN a form creator clicks a Workspace_Tab, THE Editor SHALL display the corresponding view content and visually indicate the active tab with an underline accent
3. THE Editor SHALL default to the Builder tab when the editor is first loaded
4. THE Workspace_Tabs SHALL persist their selection state across page navigation within the same form editing session

### Requirement 3: Form Canvas Layout

**User Story:** As a form creator, I want a centered, constrained-width canvas with clear visual hierarchy, so that I can focus on form content without distraction.

#### Acceptance Criteria

1. THE Form_Canvas SHALL center its content horizontally with a maximum width of 960 pixels
2. THE Form_Canvas SHALL display a light neutral background color (gray canvas) with Question_Cards rendered as white elevated containers
3. THE Form_Canvas SHALL display a form header card at the top containing the form title, description field, and a colored accent border on the left or top edge
4. THE Form_Canvas SHALL apply 16 pixels minimum spacing between consecutive Question_Cards

### Requirement 4: Question Card Active and Inactive States

**User Story:** As a form creator, I want question cards to show different levels of detail based on selection, so that I can focus on the question I am editing without visual clutter from other questions.

#### Acceptance Criteria

1. WHEN a form creator clicks a Question_Card, THE Editor SHALL transition that card to the Active_Card state with a prominent left border accent (primary color), elevated shadow, and expanded editing controls
2. WHEN a Question_Card transitions to Active_Card state, THE Editor SHALL collapse any previously Active_Card to Inactive_Card state
3. WHILE a Question_Card is in Inactive_Card state, THE Editor SHALL display only the question label, type badge, and required indicator
4. WHILE a Question_Card is in Active_Card state, THE Editor SHALL display the question type selector, label input, description input, options editor (for choice types), required toggle, duplicate button, and delete button
5. WHEN a form creator hovers over an Inactive_Card, THE Editor SHALL reveal a drag handle icon on the left side of the card

### Requirement 5: Floating Creation Toolbar

**User Story:** As a form creator, I want a quick-access toolbar for adding new elements, so that I can insert questions and sections without scrolling to an add button.

#### Acceptance Criteria

1. THE Editor SHALL display the Floating_Toolbar as a vertical stack of icon buttons positioned to the right of the Active_Card
2. THE Floating_Toolbar SHALL provide buttons for: add question, add section break, and add image/media
3. WHEN a form creator clicks the add question button on the Floating_Toolbar, THE Editor SHALL insert a new Question_Card immediately below the current Active_Card in Active_Card state with a type selector focused
4. WHEN no Question_Card is in Active_Card state, THE Floating_Toolbar SHALL position itself to the right of the last Question_Card in the Form_Canvas
5. WHEN the viewport width is less than 768 pixels, THE Floating_Toolbar SHALL reposition to the bottom of the screen as a horizontal bar

### Requirement 6: Inline Question Editing

**User Story:** As a form creator, I want to edit all question properties directly within the card, so that I can configure questions without opening separate dialogs or panels.

#### Acceptance Criteria

1. WHILE a Question_Card is in Active_Card state, THE Editor SHALL allow inline editing of the question label by clicking directly on the label text
2. WHILE a Question_Card is in Active_Card state, THE Editor SHALL display a type selector dropdown allowing the form creator to change the question type
3. WHEN a form creator changes the question type, THE Editor SHALL preserve compatible data (label, description, required status) and adapt type-specific settings to the new type
4. WHILE a Question_Card is in Active_Card state and the question type is SINGLE_CHOICE or MULTIPLE_CHOICE, THE Editor SHALL display an inline options editor with add, edit, remove, and reorder capabilities for each option
5. WHILE a Question_Card is in Active_Card state, THE Editor SHALL display a required toggle switch at the bottom of the card

### Requirement 7: Autosave with Status Indicator

**User Story:** As a form creator, I want my changes saved automatically with clear feedback, so that I never lose work and always know the save state.

#### Acceptance Criteria

1. WHEN a form creator modifies any question property (label, type, options, required, description), THE Editor SHALL initiate an autosave request after a 1500 millisecond debounce period
2. WHILE the Editor is saving changes, THE Save_Status_Indicator SHALL display "Saving…" with a subtle animation
3. WHEN the Editor successfully saves changes, THE Save_Status_Indicator SHALL display "Saved" with a checkmark icon
4. IF a save request fails due to a network error, THEN THE Save_Status_Indicator SHALL display "Offline" with a warning icon and THE Editor SHALL retry the save when connectivity is restored
5. IF a save request fails due to a server error, THEN THE Save_Status_Indicator SHALL display "Error saving" with a retry button

### Requirement 8: Undo and Redo

**User Story:** As a form creator, I want global undo/redo functionality, so that I can quickly reverse mistakes or re-apply changes.

#### Acceptance Criteria

1. THE Editor SHALL maintain an undo history stack of at least 30 actions performed during the current editing session
2. WHEN a form creator clicks the undo button or presses Ctrl+Z (Cmd+Z on macOS), THE Editor SHALL revert the most recent change and update the Form_Canvas accordingly
3. WHEN a form creator clicks the redo button or presses Ctrl+Y (Cmd+Shift+Z on macOS), THE Editor SHALL re-apply the most recently undone change
4. WHILE the undo history stack is empty, THE Editor SHALL disable the undo button visually
5. WHILE the redo stack is empty, THE Editor SHALL disable the redo button visually

### Requirement 9: Keyboard Shortcuts and Accessibility

**User Story:** As a form creator, I want keyboard shortcuts for common actions, so that I can work efficiently without relying solely on mouse interactions.

#### Acceptance Criteria

1. WHEN a form creator presses the Tab key while a Question_Card is in Active_Card state, THE Editor SHALL move focus to the next Question_Card and activate it
2. WHEN a form creator presses Shift+Tab while a Question_Card is in Active_Card state, THE Editor SHALL move focus to the previous Question_Card and activate it
3. WHEN a form creator presses the Delete key while a Question_Card is in Active_Card state and focus is not in a text input, THE Editor SHALL prompt for deletion confirmation
4. THE Editor SHALL ensure all interactive elements are reachable via keyboard navigation and announce state changes to screen readers using ARIA live regions
5. THE Editor SHALL maintain a minimum touch target size of 44x44 pixels for all interactive controls

### Requirement 10: Drag-and-Drop Reorder Enhancement

**User Story:** As a form creator, I want smooth and intuitive drag-and-drop reordering, so that I can reorganize my form structure efficiently.

#### Acceptance Criteria

1. WHEN a form creator initiates a drag on a Question_Card drag handle, THE Editor SHALL display a semi-transparent preview of the card following the cursor
2. WHILE a Question_Card is being dragged, THE Editor SHALL display a colored insertion line at valid drop positions between other cards
3. WHEN a form creator drops a Question_Card at a new position, THE Editor SHALL animate the card into its new position and persist the new order via autosave
4. THE Editor SHALL prevent drag operations from initiating when the form creator is interacting with text inputs, selects, or toggles within the Active_Card

### Requirement 11: Settings Reorganization with Progressive Disclosure

**User Story:** As a form creator, I want settings organized by intent with progressive disclosure, so that I can find and adjust settings quickly without being overwhelmed by options.

#### Acceptance Criteria

1. THE Editor Settings view SHALL organize settings into five groups: Collection (email, multiple responses), Access (scheduled publish/close, password protection), Notifications (email alerts on submission), Presentation (confirmation message, branding), and Security (CAPTCHA, rate limiting)
2. THE Editor Settings view SHALL display each group as a collapsible section with a heading and one-line description
3. WHILE a settings group is collapsed, THE Editor SHALL display a summary of the current configuration for that group
4. WHEN a form creator expands a settings group, THE Editor SHALL display common settings immediately and show an "Advanced" toggle for less frequently used options
5. WHEN a form creator modifies a setting, THE Editor SHALL autosave the change using the same debounce and status indicator pattern as question editing

### Requirement 12: Respondent View Visual Polish

**User Story:** As a respondent, I want a clean and branded form experience with smooth interactions, so that I can complete forms comfortably on any device.

#### Acceptance Criteria

1. THE Respondent_View SHALL render form content in a single centered column with a maximum width of 680 pixels and white card containers on a light background
2. THE Respondent_View SHALL display the workspace branding (logo, name, primary color) in the form header when branding data is available
3. WHEN a multi-section form is loaded, THE Respondent_View SHALL display a Progress_Indicator bar at the top showing the respondent's position relative to total sections
4. WHEN a respondent navigates between sections, THE Respondent_View SHALL apply a smooth horizontal slide transition with a duration of 300 milliseconds
5. THE Respondent_View SHALL ensure all interactive elements (buttons, radio options, checkboxes) have a minimum touch target size of 44x44 pixels
6. WHEN a respondent submits the form, THE Respondent_View SHALL display a success animation before showing the confirmation message

### Requirement 13: Preview Mode

**User Story:** As a form creator, I want to preview exactly what respondents will see, so that I can verify the form appearance and behavior before publishing.

#### Acceptance Criteria

1. WHEN a form creator clicks the preview button in the Top_Nav, THE Editor SHALL open the Respondent_View in a new browser tab with the current unsaved form state
2. THE Editor SHALL render the preview using the same Respondent_View component and styles that live respondents experience
3. THE Editor SHALL display a non-dismissible banner at the top of the preview indicating "Preview mode — responses will not be saved"

### Requirement 14: Visual Design System Consistency

**User Story:** As a form creator, I want a cohesive visual language across all editor components, so that the interface feels professional and learnable.

#### Acceptance Criteria

1. THE Editor SHALL use a consistent border radius of 12 pixels for all card containers and 8 pixels for all interactive controls (buttons, inputs, selects)
2. THE Editor SHALL apply a consistent elevation system: inactive cards at 0–2px shadow, active cards at 4–8px shadow, floating elements (toolbar, dialogs) at 8–16px shadow
3. THE Editor SHALL use the primary brand color (#2563eb) for active state accents, focus rings, and primary action buttons
4. THE Editor SHALL apply transition animations with a duration between 150 and 200 milliseconds for all state changes (hover, active, focus, expand/collapse)
5. THE Editor SHALL use a type scale with clear hierarchy: page title (2rem bold), section title (1.25rem semibold), card label (1rem medium), helper text (0.875rem regular)
