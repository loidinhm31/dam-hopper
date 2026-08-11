use std::{collections::BTreeMap, path::Path};

use crate::system::{
    platform::{read_bounded_text, ReadTextError},
    Availability, MemoryPressure, PsiLine,
};

pub fn collect(proc_root: &Path, sampled_at: u64) -> MemoryPressure {
    let path = proc_root.join("pressure/memory");
    match read_bounded_text(&path) {
        Ok(input) => parse(&input)
            .map(|(some, full)| MemoryPressure {
                some,
                full,
                availability: Availability::available(sampled_at),
            })
            .unwrap_or_else(|code| unavailable(sampled_at, code)),
        Err(ReadTextError::Io(std::io::ErrorKind::NotFound)) => MemoryPressure {
            some: None,
            full: None,
            availability: Availability::unsupported(sampled_at),
        },
        Err(ReadTextError::Io(std::io::ErrorKind::PermissionDenied)) => MemoryPressure {
            some: None,
            full: None,
            availability: Availability::denied(sampled_at),
        },
        Err(ReadTextError::TooLarge) => unavailable(sampled_at, "psiTooLarge"),
        Err(_) => unavailable(sampled_at, "psiUnavailable"),
    }
}

pub fn parse(input: &str) -> Result<(Option<PsiLine>, Option<PsiLine>), &'static str> {
    let mut lines = BTreeMap::new();
    for line in input.lines().filter(|line| !line.trim().is_empty()) {
        let mut fields = line.split_ascii_whitespace();
        let kind = fields.next().ok_or("psiMalformed")?;
        if kind != "some" && kind != "full" || lines.contains_key(kind) {
            return Err("psiMalformed");
        }
        let mut values = BTreeMap::new();
        for field in fields {
            let (name, value) = field.split_once('=').ok_or("psiMalformed")?;
            if values.insert(name, value).is_some() {
                return Err("psiMalformed");
            }
        }
        let number = |key| {
            values
                .get(key)
                .ok_or("psiMalformed")?
                .parse::<f64>()
                .map_err(|_| "psiMalformed")
        };
        let avg10 = number("avg10")?;
        let avg60 = number("avg60")?;
        let avg300 = number("avg300")?;
        if [avg10, avg60, avg300]
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
        {
            return Err("psiInvalid");
        }
        let total_micros = values
            .get("total")
            .ok_or("psiMalformed")?
            .parse::<u64>()
            .map_err(|_| "psiMalformed")?;
        lines.insert(
            kind,
            PsiLine {
                avg10,
                avg60,
                avg300,
                total_micros,
            },
        );
    }
    if lines.is_empty() {
        return Err("psiEmpty");
    }
    Ok((lines.remove("some"), lines.remove("full")))
}

fn unavailable(sampled_at: u64, code: &'static str) -> MemoryPressure {
    MemoryPressure {
        some: None,
        full: None,
        availability: Availability::unavailable(sampled_at, code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_reordered_fields() {
        let (some, full) = parse(include_str!("../fixtures/linux/psi-memory/happy.txt")).unwrap();
        assert_eq!(some.unwrap().total_micros, 30);
        assert_eq!(full.unwrap().avg60, 0.1);
    }
    #[test]
    fn rejects_nan_and_duplicates() {
        assert!(matches!(
            parse(include_str!("../fixtures/linux/psi-memory/malformed.txt")),
            Err("psiInvalid")
        ));
        assert!(parse("some avg10=1 avg10=2 avg60=1 avg300=1 total=1").is_err());
    }
}
