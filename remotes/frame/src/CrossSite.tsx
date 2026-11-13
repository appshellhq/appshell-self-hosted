import Frame, { frameVars, type SlotProps } from './Frame';

export default function CrossSite(props: SlotProps) {
  return <Frame src={frameVars().CROSS_SITE_SRC} props={props} />;
}
