import * as React from 'react';
import { PureComponentEx, translate } from '../util/ComponentEx';

export class ICollapseProps {
  showText?: string;
  hideText?: string;
}

class ICollapseState {
  show: boolean;
}

class Collapse extends PureComponentEx<ICollapseProps, ICollapseState> {
  constructor(props: ICollapseProps) {
    super(props);

    this.state = {
      show: false,
    };
  }

  public render(): JSX.Element {
    const { t, children, showText, hideText } = this.props;
    const { show } = this.state;

    const classes = ['collapse-content'];
    if (!show) {
      classes.push('collapse-content-hidden');
    }

    return (
      <div className='collapse-container'>
        <a onClick={show ? this.onHide : this.onShow}>
          {show ? (hideText || t('Hide')) : (showText || t('Show'))}
        </a>
        <div className={classes.join(' ')}>
          {children}
        </div>
      </div>
    );
  }

  private onShow = () => {
    this.setState({ show: true });
  }

  private onHide = () => {
    this.setState({ show: false });
  }
}

export default translate(['common'], { wait: true })(Collapse);
