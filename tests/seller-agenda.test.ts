import assert from "node:assert/strict";
import test from "node:test";
import {
  agendaStatusLabel,
  agendaTypeKey,
  appointmentMatchesFilter,
  sellerAgendaRange,
  type SellerAppointment,
} from "../src/lib/seller-agenda";

function appointment(overrides: Partial<SellerAppointment> = {}): SellerAppointment {
  return {
    id: "appointment-1",
    seller_id: "seller-1",
    lead_id: null,
    partnership_id: null,
    title: "Reunião de teste",
    type: "reuniao",
    status: "agendado",
    priority: "normal",
    scheduled_at: "2026-08-24T12:00:00.000Z",
    reminder_minutes: 30,
    notes: null,
    source: "manual",
    completed_at: null,
    created_at: "2026-08-24T10:00:00.000Z",
    updated_at: "2026-08-24T10:00:00.000Z",
    lead_name: null,
    lead_email: null,
    lead_phone: null,
    client_name: null,
    ...overrides,
  };
}

test("filtros da agenda distinguem tipos e estados finais", () => {
  assert.equal(appointmentMatchesFilter(appointment(), "todos"), true);
  assert.equal(appointmentMatchesFilter(appointment(), "reuniao"), true);
  assert.equal(appointmentMatchesFilter(appointment(), "pendente"), true);
  assert.equal(appointmentMatchesFilter(appointment({ status: "concluido" }), "concluido"), true);
  assert.equal(appointmentMatchesFilter(appointment({ status: "cancelado" }), "pendente"), false);
  assert.equal(appointmentMatchesFilter(appointment({ type: "ligacao" }), "call"), true);
  assert.equal(appointmentMatchesFilter(appointment({ type: "pos_venda" }), "outro"), true);
});

test("tipos legados continuam legíveis no novo calendário", () => {
  assert.equal(agendaTypeKey("ligacao"), "call");
  assert.equal(agendaTypeKey("apresentacao"), "outro");
  assert.equal(agendaStatusLabel("confirmado"), "Pendente");
});

test("consulta mensal inclui semanas adjacentes e usa fim exclusivo", () => {
  const { start, end } = sellerAgendaRange(new Date(2026, 7, 1));
  assert.equal(start.getDay(), 0);
  assert.equal(end.getDay(), 0);
  assert.ok(start < new Date(2026, 7, 1));
  assert.ok(end > new Date(2026, 7, 31));
});
