import * as React from 'react';

import { IComponentContext } from '../types/IComponentContext';
import { II18NProps } from '../types/II18NProps';

import { deleteOrNop, setSafe } from './storeHelper';

import * as PropTypes from 'prop-types';
export { translate } from 'react-i18next';
export { connect } from 'react-redux';
export { extend } from './ExtensionProvider';

export class StateProxyHandler<T extends object> implements ProxyHandler<T> {
  private mComponent: ComponentEx<any, T> | PureComponentEx<any, T>;
  private mPath: string[];
  private mBaseObject: T;
  private mParent: StateProxyHandler<T>;
  private mSubProxies: { [key: string]: {
    proxy: any,
    obj: any,
  } };

  constructor(component: ComponentEx<any, T> | PureComponentEx<any, T>,
              baseObject: T, parent: StateProxyHandler<T>, objPath: string[]) {
    this.mComponent = component;
    this.mPath = objPath;
    this.mBaseObject = baseObject;
    this.mParent = parent;
    this.mSubProxies = {};
  }

  public has(target: T, key: PropertyKey): boolean {
    return key in target;
  }

  public get(target: T, key: PropertyKey): any {
    return this.derive(target, key);
  }

  public deleteProperty(target: T, key: PropertyKey): boolean {
    delete target[key];
    const fullPath = [].concat(this.mPath, key);
    this.setBaseObject(deleteOrNop(this.baseObject(), fullPath));
    this.mComponent.setState(this.baseObject());
    return true;
  }

  public set(target: T, key: PropertyKey, value: any, receiver: any): boolean {
    target[key] = value;
    const fullPath = [].concat(this.mPath, key);
    this.setBaseObject(setSafe(this.baseObject(), fullPath, value));
    return true;
  }

  private baseObject(): T {
    if (this.mParent === undefined) {
      return this.mBaseObject;
    } else {
      return this.mParent.baseObject();
    }
  }

  private setBaseObject(newObj: T) {
    if (this.mParent === undefined) {
      this.mBaseObject = newObj;
      this.mComponent.setState(this.mBaseObject);
    } else {
      this.mParent.setBaseObject(newObj);
    }
  }

  private derive(obj: T, key: PropertyKey) {
    if ((typeof(obj[key]) !== 'object') || (typeof key !== 'string')) {
      return obj[key];
    }

    if (!(key in this.mSubProxies) || (obj[key] !== this.mSubProxies[key].obj)) {
      this.mSubProxies[key] = {
        proxy: new Proxy(obj[key],
          new StateProxyHandler(this.mComponent, null, this, [].concat(this.mPath, key))),
        obj: obj[key],
      };
    }
    return this.mSubProxies[key].proxy;
  }
}

/**
 * convenience extension for React.Component that adds support for the
 * i18n library.
 *
 * This whole module is just here to reduce the code required for "decorated"
 * components.
 *
 * @export
 * @class ComponentEx
 * @extends {(React.Component<P & II18NProps, S>)}
 * @template P
 * @template S
 */
export class ComponentEx<P, S extends object> extends React.Component<P & II18NProps, S> {
  public static contextTypes: React.ValidationMap<any> = {
    api: PropTypes.object.isRequired,
    menuLayer: PropTypes.object,
    getModifiers: PropTypes.func,
  };

  public context: IComponentContext;

  public nextState: S;

  protected initState(value: S) {
    this.state = value;

    const proxyHandler = new StateProxyHandler(this, value, undefined, []);

    this.nextState = new Proxy<S>(value, proxyHandler);
  }
}

export class PureComponentEx<P, S extends object> extends React.PureComponent<P & II18NProps, S> {
  public static contextTypes: React.ValidationMap<any> = {
    api: PropTypes.object.isRequired,
    menuLayer: PropTypes.object,
    getModifiers: PropTypes.func,
  };

  public context: IComponentContext;

  public nextState: S;

  protected initState(value: S) {
    this.state = value;

    const proxyHandler = new StateProxyHandler(this, value, undefined, []);

    this.nextState = new Proxy<S>(value, proxyHandler);
  }
}
