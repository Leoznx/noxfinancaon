import assert from "node:assert/strict";
import test from "node:test";
import {
  agendaStatusLabel,
  agendaTypeKey,
  appointmentMatchesFilter,
  getAppointmentContact,
  sellerAgendaRange,
  type SellerAppointment,
} from "../src/lib/seller-agenda";

function appointment(overrides: Partial<SellerAppointment> = {}): SellerAppointment {
  return {
    id: "appointment-1",
    seller_id: "seller-1",
    sdr_id: null,
    assigned_closer_id: null,
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
    duration_minutes: 60,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
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

test("detalhes priorizam nome e telefone informados na reunião compartilhada", () => {
  const contact = getAppointmentContact(appointment({
    contact_name: "Simone Ferreira",
    contact_phone: "(11) 99999-8888",
    lead_name: "Nome antigo",
    lead_phone: "(11) 2222-3333",
  }));

  assert.deepEqual(contact, {
    name: "Simone Ferreira",
    phone: "(11) 99999-8888",
  });
});

test("detalhes usam os dados do lead quando a reunião não possui contato próprio", () => {
  const contact = getAppointmentContact(appointment({
    lead_name: "Cliente do lead",
    lead_phone: "(47) 98888-7777",
  }));

  assert.deepEqual(contact, {
    name: "Cliente do lead",
    phone: "(47) 98888-7777",
  });
});
