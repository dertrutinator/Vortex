import { setDialogVisible, setOpenMainPage } from '../actions/session';
import { setTabsMinimized } from '../actions/window';
import Banner from '../controls/Banner';
import FlexLayout from '../controls/FlexLayout';
import Icon from '../controls/Icon';
import IconBar from '../controls/IconBar';
import Spinner from '../controls/Spinner';
import { Button, NavItem } from '../controls/TooltipControls';
import { IActionDefinition } from '../types/IActionDefinition';
import { IComponentContext } from '../types/IComponentContext';
import { IExtensionApi, IMainPageOptions } from '../types/IExtensionContext';
import { II18NProps } from '../types/II18NProps';
import { IMainPage } from '../types/IMainPage';
import { IModifiers } from '../types/IModifiers';
import { INotification } from '../types/INotification';
import { IProgress, IState } from '../types/IState';
import { connect, extend } from '../util/ComponentEx';
import { getSafe } from '../util/storeHelper';
import { truthy } from '../util/util';
import Dialog from './Dialog';
import DialogContainer from './DialogContainer';
import DNDContainer from './DNDContainer';
import MainFooter from './MainFooter';
import MainPageContainer from './MainPageContainer';
import NotificationButton from './NotificationButton';
import PageButton from './PageButton';
import QuickLauncher from './QuickLauncher';
import Settings from './Settings';
import WindowControls from './WindowControls';

import * as I18next from 'i18next';
import update from 'immutability-helper';
import * as _ from 'lodash';
import * as PropTypes from 'prop-types';
import * as React from 'react';
import { Button as ReactButton, Nav, ProgressBar } from 'react-bootstrap';
// tslint:disable-next-line:no-submodule-imports
import {addStyle} from 'react-bootstrap/lib/utils/bootstrapUtils';
import * as Redux from 'redux';
import { ThunkDispatch } from 'redux-thunk';

addStyle(ReactButton, 'secondary');
addStyle(ReactButton, 'ad');
addStyle(ReactButton, 'ghost');
addStyle(ReactButton, 'inverted');

export interface IBaseProps {
  t: I18next.TranslationFunction;
  className: string;
  api: IExtensionApi;
}

export interface IExtendedProps {
  objects: IMainPage[];
}

export interface IMainWindowState {
  showLayer: string;
  loadedPages: string[];
  hidpi: boolean;
  focused: boolean;
}

export interface IConnectedProps {
  tabsMinimized: boolean;
  visibleDialog: string;
  mainPage: string;
  secondaryPage: string;
  activeProfileId: string;
  nextProfileId: string;
  progressProfile: { [progressId: string]: IProgress };
  customTitlebar: boolean;
  userInfo: any;
  notifications: INotification[];
  APIKey: string;
}

export interface IActionProps {
  onSetTabsMinimized: (minimized: boolean) => void;
  onSetOpenMainPage: (page: string, secondary: boolean) => void;
  onHideDialog: () => void;
}

export type IProps = IBaseProps & IConnectedProps & IExtendedProps & IActionProps & II18NProps;

export class MainWindow extends React.Component<IProps, IMainWindowState> {
  // tslint:disable-next-line:no-unused-variable
  public static childContextTypes: React.ValidationMap<any> = {
    api: PropTypes.object.isRequired,
    menuLayer: PropTypes.object,
    getModifiers:  PropTypes.func,
  };

  private applicationButtons: IActionDefinition[];

  private settingsPage: IMainPage;
  private nextState: IMainWindowState;
  private globalButtons: IActionDefinition[] = [];
  private modifiers: IModifiers = { alt: false, ctrl: false, shift: false };

  private menuLayer: JSX.Element = null;

  private headerRef: HTMLElement = null;
  private sidebarRef: HTMLElement = null;
  private sidebarTimer: NodeJS.Timer;

  constructor(props: IProps) {
    super(props);

    this.state = this.nextState = {
      showLayer: '',
      loadedPages: [],
      hidpi: false,
      focused: true,
    };

    this.settingsPage = {
      id: 'application_settings',
      title: 'Settings',
      group: 'global',
      component: Settings,
      icon: 'settings',
      propsFunc: () => undefined,
      visible: () => true,
    };

    this.applicationButtons = [];

    this.props.api.events.on('show-main-page', pageId => {
      this.setMainPage(pageId, false);
    });

    this.props.api.events.on('refresh-main-page', () => {
      this.forceUpdate();
    });

    this.props.api.events.on('show-modal', id => {
      this.updateState({
        showLayer: { $set: id },
      });
    });
  }

  public getChildContext(): IComponentContext {
    const { api } = this.props;
    return { api, menuLayer: this.menuLayer, getModifiers: () => this.modifiers };
  }

  public componentWillMount() {
    if (this.props.objects.length > 0) {
      const def = this.props.objects.sort((lhs, rhs) => lhs.priority - rhs.priority)[0];
      this.setMainPage(def.title, false);
    }

    if (this.props.customTitlebar) {
      document.body.classList.add('custom-titlebar-body');
    }

    this.updateSize();
  }

  public componentDidMount() {
    window.addEventListener('resize', this.updateSize);
    window.addEventListener('keydown', this.updateModifiers);
    window.addEventListener('keyup', this.updateModifiers);
    window.addEventListener('focus', this.setFocus);
    window.addEventListener('blur', this.unsetFocus);
  }

  public componentWillUnmount() {
    window.removeEventListener('resize', this.updateSize);
    window.removeEventListener('keydown', this.updateModifiers);
    window.removeEventListener('keyup', this.updateModifiers);
    window.removeEventListener('focus', this.setFocus);
    window.removeEventListener('blur', this.unsetFocus);
  }

  public shouldComponentUpdate(nextProps: IProps, nextState: IMainWindowState) {
    return this.props.visibleDialog !== nextProps.visibleDialog
      || this.props.tabsMinimized !== nextProps.tabsMinimized
      || this.props.mainPage !== nextProps.mainPage
      || this.props.secondaryPage !== nextProps.secondaryPage
      || this.props.activeProfileId !== nextProps.activeProfileId
      || this.props.nextProfileId !== nextProps.nextProfileId
      || this.props.progressProfile !== nextProps.progressProfile
      || this.props.userInfo !== nextProps.userInfo
      || this.state.showLayer !== nextState.showLayer
      || this.state.hidpi !== nextState.hidpi
      || this.state.focused !== nextState.focused
      ;
  }

  public componentWillReceiveProps(newProps: IProps) {
    const page = newProps.objects.find(iter => iter.title === newProps.mainPage);
    if ((page !== undefined) && !page.visible()) {
      this.setMainPage('Dashboard', false);
    }
  }

  public render(): JSX.Element {
    const { activeProfileId, customTitlebar, onHideDialog,
            nextProfileId, visibleDialog } = this.props;
    const { focused, hidpi } = this.state;

    const switchingProfile = ((activeProfileId !== nextProfileId) && truthy(nextProfileId));

    const classes = [];
    classes.push(hidpi ? 'hidpi' : 'lodpi');
    classes.push(focused ? 'window-focused' : 'window-unfocused');
    if (customTitlebar) {
      // a border around the window if the standard os frame is disabled.
      // this is important to indicate to the user he can resize the window
      // (even though it's not actually this frame that lets him do it)
      classes.push('window-frame');
    }
    return (
      <>
        {switchingProfile ? this.renderWait() : null}
        <div key='main' className={classes.join(' ')} style={{ display: switchingProfile ? 'none' : undefined }}>
          <div className='menu-layer' ref={this.setMenuLayer} />
          <FlexLayout id='main-window-content' type='column'>
            {this.renderToolbar(switchingProfile)}
            {customTitlebar ? <div className='dragbar' /> : null}
            {this.renderBody()}
          </FlexLayout>
          <Dialog />
          <DialogContainer visibleDialog={visibleDialog} onHideDialog={onHideDialog} />
          {customTitlebar ? <WindowControls /> : null}
        </div>
      </>);
  }

  private renderWait() {
    const { onHideDialog, progressProfile, visibleDialog } = this.props;
    const progress = getSafe(progressProfile, ['deploying'], undefined);
    const control = progress !== undefined
      ? <ProgressBar label={progress.text} now={progress.percent} style={{ width: '50%' }} />
      : <Spinner style={{ width: 64, height: 64 }} />;
    return (
      <div key='wait'>
        <div className='center-content'>{control}</div>
        <Dialog />
        <DialogContainer visibleDialog={visibleDialog} onHideDialog={onHideDialog} />
      </div>
    );
  }

  private updateModifiers = (event: KeyboardEvent) => {
    const newModifiers = {
      alt: event.altKey,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
    };
    if (!_.isEqual(newModifiers, this.modifiers)) {
      this.modifiers = newModifiers;
    }
  }

  private updateState(spec: any) {
    this.nextState = update(this.nextState, spec);
    this.setState(this.nextState);
  }

  private renderToolbar(switchingProfile: boolean) {
    const { t, customTitlebar } = this.props;
    const className = customTitlebar ? 'toolbar-app-region' : 'toolbar-default';
    return (
      <FlexLayout.Fixed id='main-toolbar' className={className}>
        <QuickLauncher t={t} />
        <Banner group='main-toolbar' />
        <div className='flex-fill' />
        <div className='main-toolbar-right'>
          <NotificationButton id='notification-button' hide={switchingProfile} />
          <IconBar
            className='application-icons'
            group='application-icons'
            staticElements={this.applicationButtons}
            t={t}
          />
          <IconBar
            id='global-icons'
            className='global-icons'
            group='global-icons'
            staticElements={this.globalButtons}
            orientation='vertical'
            collapse
            t={t}
          />
        </div>
      </FlexLayout.Fixed>
    );
  }

  private updateSize = () => {
    this.updateState({
      hidpi: { $set: screen.width > 1920 },
    });
  }

  private setFocus = () => {
    this.updateState({
      focused: { $set: true },
    });
  }

  private unsetFocus = () => {
    this.updateState({
      focused: { $set: false },
    });
  }

  private renderBody() {
    const { t, objects, tabsMinimized } = this.props;

    const sbClass = tabsMinimized ? 'sidebar-compact' : 'sidebar-expanded';

    const pages = objects.map(obj => this.renderPage(obj));
    pages.push(this.renderPage(this.settingsPage));

    const pageGroups = [
      { title: undefined, key: 'dashboard' },
      { title: 'General', key: 'global' },
      { title: 'Mods', key: 'per-game' },
      { title: 'About', key: 'support' },
    ];

    return (
      <FlexLayout.Flex>
        <FlexLayout type='row' style={{ overflow: 'hidden' }}>
          <FlexLayout.Fixed id='main-nav-sidebar' className={sbClass}>
            <div id='main-nav-container' ref={this.setSidebarRef}>
              {pageGroups.map(this.renderPageGroup)}
            </div>
            <MainFooter slim={tabsMinimized} />
            <Button
              tooltip={tabsMinimized ? t('Restore') : t('Minimize')}
              id='btn-minimize-menu'
              onClick={this.toggleMenu}
              className='btn-menu-minimize'
            >
              <Icon name={tabsMinimized ? 'pane-right' : 'pane-left'} />
            </Button>
          </FlexLayout.Fixed>
          <FlexLayout.Flex fill id='main-window-pane'>
            <DNDContainer style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {pages}
            </DNDContainer>
          </FlexLayout.Flex>
        </FlexLayout>
      </FlexLayout.Flex>
    );
  }

  private renderPageGroup = ({ title, key }: { title: string, key: string }): JSX.Element => {
    const { mainPage, objects, tabsMinimized } = this.props;
    const pages = objects.filter(page => (page.group === key) && page.visible());
    if (key === 'global') {
      pages.push(this.settingsPage);
    }

    if (pages.length === 0) {
      return null;
    }

    const showTitle = !tabsMinimized && (title !== undefined);

    return (
      <div key={key}>
        {showTitle ? <p className='main-nav-group-title'>{title}</p> : null}
        <Nav
          bsStyle='pills'
          stacked
          activeKey={mainPage}
          className='main-nav-group'
        >
          {pages.map(this.renderPageButton)}
        </Nav>
      </div>
    );
  }

  private setHeaderRef = ref => {
    this.headerRef = ref;
  }

  private getHeaderRef = () => this.headerRef;

  private setSidebarRef = ref => {
    this.sidebarRef = ref;
    if (this.sidebarRef !== null) {
      this.sidebarRef.setAttribute('style',
        'min-width: ' + ref.getBoundingClientRect().width + 'px');
    }
  }

  private renderPageButton = (page: IMainPage, idx: number) => {
    const { t, secondaryPage } = this.props;
    return (
      <NavItem
        id={page.id}
        className={secondaryPage === page.id ? 'secondary' : undefined}
        key={page.id}
        eventKey={page.id}
        tooltip={t(page.title)}
        placement='right'
        onClick={this.handleClickPage}
      >
        <PageButton
          t={this.props.t}
          page={page}
        />
      </NavItem>
    );
  }

  private renderPage(page: IMainPage) {
    const { mainPage, secondaryPage } = this.props;
    const { loadedPages } = this.state;

    if (loadedPages.indexOf(page.id) === -1) {
      // don't render pages that have never been opened
      return null;
    }

    const active = [mainPage, secondaryPage].indexOf(page.id) !== -1;

    return (
      <MainPageContainer
        key={page.id}
        page={page}
        active={active}
        secondary={secondaryPage === page.id}
      />
    );
  }

  private setMenuLayer = (ref) => {
    this.menuLayer = ref;
  }

  private handleClickPage = (evt: React.MouseEvent<any>) => {
    this.setMainPage(evt.currentTarget.id, evt.ctrlKey);
  }

  private setMainPage = (pageId: string, secondary: boolean) => {
    // set the page as "loaded", set it as the shown page next frame.
    // this way it gets rendered as hidden once and can then "transition"
    // to visible
    if (this.state.loadedPages.indexOf(pageId) === -1) {
      this.updateState({
        loadedPages: { $push: [pageId] },
      });
    }
    setImmediate(() => {
      if (secondary && (pageId === this.props.secondaryPage)) {
        this.props.onSetOpenMainPage('', secondary);
      } else {
        this.props.onSetOpenMainPage(pageId, secondary);
      }
    });
  }

  private toggleMenu = () => {
    const newMinimized = !this.props.tabsMinimized;
    this.props.onSetTabsMinimized(newMinimized);
    if (this.sidebarTimer !== undefined) {
      clearTimeout(this.sidebarTimer);
      this.sidebarTimer = undefined;
    }
    if (this.sidebarRef !== null) {
      if (newMinimized) {
        this.sidebarRef.setAttribute('style', '');
      } else {
        this.sidebarTimer = setTimeout(() => {
          this.sidebarTimer = undefined;
          this.sidebarRef.setAttribute('style',
            'min-width:' + this.sidebarRef.getBoundingClientRect().width + 'px');
        }, 500);
      }
    }
  }
}

function trueFunc() {
  return true;
}

function emptyFunc() {
  return {};
}

function mapStateToProps(state: IState): IConnectedProps {
  return {
    tabsMinimized: getSafe(state, ['settings', 'window', 'tabsMinimized'], false),
    visibleDialog: state.session.base.visibleDialog,
    mainPage: state.session.base.mainPage,
    secondaryPage: state.session.base.secondaryPage,
    activeProfileId: state.settings.profiles.activeProfileId,
    nextProfileId: state.settings.profiles.nextProfileId,
    progressProfile: getSafe(state.session.base, ['progress', 'profile'], undefined),
    customTitlebar: state.settings.window.customTitlebar,
    userInfo: getSafe(state, ['persistent', 'nexus', 'userInfo'], undefined),
    APIKey: getSafe(state, ['confidential', 'account', 'nexus', 'APIKey'], ''),
    notifications: state.session.notifications.notifications,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onSetTabsMinimized: (minimized: boolean) => dispatch(setTabsMinimized(minimized)),
    onSetOpenMainPage:
      (page: string, secondary: boolean) => dispatch(setOpenMainPage(page, secondary)),
    onHideDialog: () => dispatch(setDialogVisible(undefined)),
  };
}

function registerMainPage(
  instanceGroup: undefined,
  icon: string,
  title: string,
  component: React.ComponentClass<any> | React.StatelessComponent<any>,
  options: IMainPageOptions): IMainPage {
  return {
    id: options.id || title,
    icon,
    title,
    component,
    propsFunc: options.props || emptyFunc,
    visible: options.visible || trueFunc,
    group: options.group,
    badge: options.badge,
    activity: options.activity,
    priority: options.priority !== undefined ? options.priority : 100,
  };
}

export default
  extend(registerMainPage)(
    connect(mapStateToProps, mapDispatchToProps)(
      MainWindow),
  ) as React.ComponentClass<IBaseProps>;
