//! Safe error codes for semantic transport parsing.

#[derive(Debug, thiserror::Error, Eq, PartialEq)]
pub enum SemanticTransportError {
    #[error("semantic message is invalid")]
    InvalidMessage,
    #[error("semantic message kind is unknown")]
    UnknownMessage,
    #[error("semantic message field is unknown")]
    UnknownField,
    #[error("semantic identifier is invalid")]
    InvalidIdentifier(&'static str),
    #[error("semantic path is invalid")]
    InvalidRelativePath,
    #[error("semantic range is invalid")]
    InvalidRange,
    #[error("semantic position is outside the limit")]
    PositionOutsideLimit,
    #[error("semantic text is invalid")]
    InvalidText(&'static str),
    #[error("semantic target limit is exceeded")]
    TargetLimitExceeded,
    #[error("semantic sequence is outside the limit")]
    SequenceOutsideLimit,
    #[error("semantic document is too large")]
    DocumentTooLarge,
    #[error("semantic message is too large")]
    MessageTooLarge,
}

impl From<super::protocol::ProtocolError> for SemanticTransportError {
    fn from(error: super::protocol::ProtocolError) -> Self {
        use super::protocol::ProtocolError;
        match error {
            ProtocolError::InvalidIdentifier(field) => Self::InvalidIdentifier(field),
            ProtocolError::InvalidRelativePath => Self::InvalidRelativePath,
            ProtocolError::InvalidRange => Self::InvalidRange,
            ProtocolError::PositionOutsideLimit => Self::PositionOutsideLimit,
            ProtocolError::InvalidText(field) => Self::InvalidText(field),
            ProtocolError::TargetLimitExceeded => Self::TargetLimitExceeded,
            ProtocolError::SequenceOutsideLimit => Self::SequenceOutsideLimit,
            ProtocolError::ResponseTooLarge => Self::MessageTooLarge,
        }
    }
}
