use std::collections::BTreeMap;

use tracing::{Event, Subscriber};
use tracing_subscriber::{layer::Context, Layer};

use super::{now_ms, DiagnosticEvent, DiagnosticStore};

#[derive(Clone)]
pub struct DiagnosticTracingLayer {
    store: DiagnosticStore,
}

impl DiagnosticTracingLayer {
    pub fn new(store: DiagnosticStore) -> Self {
        Self { store }
    }
}

impl<S> Layer<S> for DiagnosticTracingLayer
where
    S: Subscriber,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let source = event.metadata().target();
        if source.contains("diagnostics") {
            return;
        }

        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);
        let message = visitor
            .fields
            .remove("message")
            .unwrap_or_else(|| event.metadata().name().to_string());

        self.store.record_event(DiagnosticEvent {
            timestamp_ms: now_ms(),
            level: event.metadata().level().to_string(),
            source: source.to_string(),
            message,
            fields: visitor.fields,
        });
    }
}

#[derive(Default)]
struct FieldVisitor {
    fields: BTreeMap<String, String>,
}

impl tracing::field::Visit for FieldVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.fields
            .insert(field.name().to_string(), format!("{value:?}"));
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.fields
            .insert(field.name().to_string(), value.to_string());
    }

    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.fields
            .insert(field.name().to_string(), value.to_string());
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.fields
            .insert(field.name().to_string(), value.to_string());
    }

    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        self.fields
            .insert(field.name().to_string(), value.to_string());
    }
}
