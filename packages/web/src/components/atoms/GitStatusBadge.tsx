import { Badge } from "./Badge.js";

interface Props {
  isClean: boolean | undefined;
}

export function GitStatusBadge({ isClean }: Props) {
  if (isClean === undefined) return <Badge variant="neutral">Unknown</Badge>;
  return isClean ? (
    <Badge variant="success">Clean</Badge>
  ) : (
    <Badge variant="warning">Dirty</Badge>
  );
}
