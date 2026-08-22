import { Router, type Router as ExpressRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth.js";
import { createEventSchema, updateEventSchema, addFormToEventSchema } from "./event.schemas.js";
import { addFormToEvent, createEvent, deleteEvent, getEvent, listEvents, removeFormFromEvent, updateEvent } from "./event.service.js";

const eventRouter: ExpressRouter = Router();

// List events
eventRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    const workspaceId = req.query.workspaceId;
    if (typeof workspaceId !== "string") { res.status(400).json({ success: false, error: { code: "INVALID_WORKSPACE_ID", message: "workspaceId is required." } }); return; }
    const events = await listEvents(workspaceId, req.user.id);
    res.json({ success: true, data: { events } });
  } catch (error) { next(error); }
});

// Create event
eventRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    const input = createEventSchema.parse(req.body);
    const event = await createEvent({ workspaceId: input.workspaceId, userId: req.user.id, name: input.name, ...(input.description !== undefined ? { description: input.description } : {}), ...(input.startDate !== undefined ? { startDate: input.startDate } : {}), ...(input.endDate !== undefined ? { endDate: input.endDate } : {}) });
    res.status(201).json({ success: true, data: { event } });
  } catch (error) { next(error); }
});

// Get event with forms
eventRouter.get("/:eventId", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    const eventId = req.params.eventId;
    if (typeof eventId !== "string") { res.status(400).json({ success: false, error: { code: "INVALID_EVENT_ID", message: "A valid event ID is required." } }); return; }
    const event = await getEvent(eventId, req.user.id);
    res.json({ success: true, data: { event } });
  } catch (error) { next(error); }
});

// Update event
eventRouter.patch("/:eventId", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    const eventId = req.params.eventId;
    if (typeof eventId !== "string") { res.status(400).json({ success: false, error: { code: "INVALID_EVENT_ID", message: "A valid event ID is required." } }); return; }
    const input = updateEventSchema.parse(req.body);
    const event = await updateEvent(eventId, req.user.id, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.startDate !== undefined ? { startDate: input.startDate } : {}), ...(input.endDate !== undefined ? { endDate: input.endDate } : {}) });
    res.json({ success: true, data: { event } });
  } catch (error) { next(error); }
});

// Delete event
eventRouter.delete("/:eventId", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    const eventId = req.params.eventId;
    if (typeof eventId !== "string") { res.status(400).json({ success: false, error: { code: "INVALID_EVENT_ID", message: "A valid event ID is required." } }); return; }
    await deleteEvent(eventId, req.user.id);
    res.json({ success: true, data: { message: "Event deleted." } });
  } catch (error) { next(error); }
});

// Add form to event
eventRouter.post("/:eventId/forms", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    const eventId = req.params.eventId;
    if (typeof eventId !== "string") { res.status(400).json({ success: false, error: { code: "INVALID_EVENT_ID", message: "A valid event ID is required." } }); return; }
    const input = addFormToEventSchema.parse(req.body);
    const form = await addFormToEvent(eventId, input.formId, req.user.id);
    res.json({ success: true, data: { form } });
  } catch (error) { next(error); }
});

// Remove form from event
eventRouter.delete("/:eventId/forms/:formId", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    const { eventId, formId } = req.params;
    if (typeof eventId !== "string" || typeof formId !== "string") { res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Valid IDs required." } }); return; }
    await removeFormFromEvent(eventId, formId, req.user.id);
    res.json({ success: true, data: { message: "Form removed from event." } });
  } catch (error) { next(error); }
});

export default eventRouter;
