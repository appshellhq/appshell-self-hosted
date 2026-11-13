import Frame, { frameVars, type SlotProps } from './Frame';

export default function OwnOrigin(props: SlotProps) {
  return <Frame src={frameVars().OWN_ORIGIN_SRC} props={props} />;
}
