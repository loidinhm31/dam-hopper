//! Canonical decimal-string u64 counters for Browser identities.
//!
//! `profileEpoch`, `viewportEpoch`, `navigationRevision`, `selectionRevision`, `inputSeq`,
//! `frameSeq` and every other counter on a REST/WS/selection/reset DTO cross the wire as strings
//! matching `^(0|[1-9][0-9]{0,19})$` with a value `<= u64::MAX`, so identities stay exact above
//! 2^53. JSON numbers are never accepted: there is no compatibility path.
//!
//! `parse_canonical_u64` is the single parser. The `positive`/`nonneg`/`positive_opt` modules are
//! `#[serde(with = "...")]` adapters over it; internal structs keep plain `u64` fields.

use std::fmt;

use serde::de::{self, Visitor};
use serde::{Deserializer, Serializer};

/// Parses a canonical decimal counter. Rejects empty input, signs, whitespace, non-ASCII digits,
/// leading zeros, overflow and (unless `allow_zero`) the value zero.
pub fn parse_canonical_u64(s: &str, allow_zero: bool) -> Option<u64> {
    let bytes = s.as_bytes();
    if bytes.is_empty() || bytes.len() > 20 || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    if bytes[0] == b'0' && bytes.len() > 1 {
        return None;
    }
    let value = s.parse::<u64>().ok()?;
    (allow_zero || value != 0).then_some(value)
}

struct DecimalVisitor {
    allow_zero: bool,
}

impl<'de> Visitor<'de> for DecimalVisitor {
    type Value = u64;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        if self.allow_zero {
            f.write_str("a canonical decimal u64 string (^(0|[1-9][0-9]{0,19})$)")
        } else {
            f.write_str("a canonical positive decimal u64 string (^[1-9][0-9]{0,19}$)")
        }
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<u64, E> {
        parse_canonical_u64(v, self.allow_zero).ok_or_else(|| E::invalid_value(de::Unexpected::Str(v), &self))
    }
}

struct OptionalVisitor {
    allow_zero: bool,
}

impl<'de> Visitor<'de> for OptionalVisitor {
    type Value = Option<u64>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("null or a canonical decimal u64 string")
    }

    fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_str(DecimalVisitor { allow_zero: self.allow_zero }).map(Some)
    }
}

/// Counter that starts at 1 (`profileEpoch`, `viewportEpoch`, `navigationRevision`, `inputSeq`).
pub mod positive {
    use super::*;

    pub fn serialize<S: Serializer>(value: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(value)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        d.deserialize_str(DecimalVisitor { allow_zero: false })
    }
}

/// Counter that may legitimately be zero (`selectionRevision`, terminal incarnation).
pub mod nonneg {
    use super::*;

    pub fn serialize<S: Serializer>(value: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(value)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        d.deserialize_str(DecimalVisitor { allow_zero: true })
    }
}

/// Optional positive counter; pair with `#[serde(default)]` for an absent field.
pub mod positive_opt {
    use super::*;

    pub fn serialize<S: Serializer>(value: &Option<u64>, s: S) -> Result<S::Ok, S::Error> {
        match value {
            Some(v) => s.collect_str(v),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
        d.deserialize_option(OptionalVisitor { allow_zero: false })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_canonical_decimals() {
        assert_eq!(parse_canonical_u64("1", false), Some(1));
        assert_eq!(parse_canonical_u64("9007199254740993", false), Some(9_007_199_254_740_993));
        assert_eq!(parse_canonical_u64("18446744073709551615", false), Some(u64::MAX));
        assert_eq!(parse_canonical_u64("0", true), Some(0));
        assert_eq!(parse_canonical_u64("0", false), None);
        for bad in ["", "01", "00", "+1", "-1", " 1", "1 ", "1.0", "1e3", "0x1", "18446744073709551616", "١", "123456789012345678901"] {
            assert_eq!(parse_canonical_u64(bad, true), None, "{bad:?}");
        }
    }
}
