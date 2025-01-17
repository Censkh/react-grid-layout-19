// @flow
import React from "react";
import { DraggableCore } from "react-draggable";
import { Resizable } from "react-resizable";
import { perc, resizeItemInDirection, setTopLeft, setTransform } from "./utils";
import {
  calcGridItemPosition,
  calcGridItemWHPx,
  calcGridColWidth,
  calcXY,
  calcWH,
  clamp
} from "./calculateUtils";
import {
  resizeHandleAxesType,
  resizeHandleType
} from "./ReactGridLayoutPropTypes";
import clsx from "clsx";
import type { Element as ReactElement, Node as ReactNode } from "react";

import type {
  ReactDraggableCallbackData,
  GridDragEvent,
  GridResizeEvent,
  DroppingPosition,
  Position,
  ResizeHandleAxis
} from "./utils";

import type { PositionParams } from "./calculateUtils";
import type { ResizeHandle, ReactRef } from "./ReactGridLayoutPropTypes";

type PartialPosition = { top: number, left: number };
type GridItemCallback<Data: GridDragEvent | GridResizeEvent> = (
  i: string,
  w: number,
  h: number,
  Data
) => void;

type ResizeCallbackData = {
  node: HTMLElement,
  size: Position,
  handle: ResizeHandleAxis
};

type GridItemResizeCallback = (
  e: Event,
  data: ResizeCallbackData,
  position: Position
) => void;

type State = {
  resizing: boolean,
  dragging: boolean,
  className: string
};

type Props = {
  children: ReactElement<any>,
  cols: number,
  containerWidth: number,
  margin: [number, number],
  containerPadding: [number, number],
  rowHeight: number,
  maxRows: number,
  isDraggable: boolean,
  isResizable: boolean,
  isBounded: boolean,
  static?: boolean,
  useCSSTransforms?: boolean,
  usePercentages?: boolean,
  transformScale: number,
  droppingPosition?: DroppingPosition,

  className: string,
  style?: Object,
  // Draggability
  cancel: string,
  handle: string,

  x: number,
  y: number,
  w: number,
  h: number,

  minW: number,
  maxW: number,
  minH: number,
  maxH: number,
  i: string,

  resizeHandles?: ResizeHandleAxis[],
  resizeHandle?: ResizeHandle,

  onDrag?: GridItemCallback<GridDragEvent>,
  onDragStart?: GridItemCallback<GridDragEvent>,
  onDragStop?: GridItemCallback<GridDragEvent>,
  onResize?: GridItemCallback<GridResizeEvent>,
  onResizeStart?: GridItemCallback<GridResizeEvent>,
  onResizeStop?: GridItemCallback<GridResizeEvent>
};

type DefaultProps = {
  className: string,
  cancel: string,
  handle: string,
  minH: number,
  minW: number,
  maxH: number,
  maxW: number,
  transformScale: number
};

/**
 * An individual item within a ReactGridLayout.
 */
export default class GridItem extends React.Component<Props, State> {
  static defaultProps: DefaultProps = {
    className: "",
    cancel: "",
    handle: "",
    minH: 1,
    minW: 1,
    maxH: Infinity,
    maxW: Infinity,
    transformScale: 1
  };

  dragPosition: PartialPosition = { left: 0, top: 0 };
  resizePosition: { top: number, left: number, width: number, height: number } =
    { top: 0, left: 0, width: 0, height: 0 };

  elementRef: ReactRef<HTMLDivElement> = React.createRef();

  shouldComponentUpdate(nextProps: Props, nextState: State): boolean {
    // We can't deeply compare children. If the developer memoizes them, we can
    // use this optimization.
    if (this.props.children !== nextProps.children) return true;
    if (this.props.droppingPosition !== nextProps.droppingPosition) return true;
    if (this.props.useCSSTransforms !== nextProps.useCSSTransforms) return true;
    return true;
  }

  componentDidMount() {
    this.moveDroppingItem({});
  }

  componentDidUpdate(prevProps: Props) {
    this.moveDroppingItem(prevProps);
  }

  // When a droppingPosition is present, this means we should fire a move event, as if we had moved
  // this element by `x, y` pixels.
  moveDroppingItem(prevProps: Props) {
    const { droppingPosition } = this.props;
    if (!droppingPosition) return;
    const node = this.elementRef.current;
    // Can't find DOM node (are we unmounted?)
    if (!node) return;

    const prevDroppingPosition = prevProps.droppingPosition || {
      left: 0,
      top: 0
    };

    const shouldDrag =
      (this.dragging &&
        droppingPosition.left !== prevDroppingPosition.left) ||
      droppingPosition.top !== prevDroppingPosition.top;

    if (!this.dragging) {
      this.onDragStart(droppingPosition.e, {
        node,
        deltaX: droppingPosition.left,
        deltaY: droppingPosition.top
      });
    } else if (shouldDrag) {
      const deltaX = droppingPosition.left - this.dragPosition.left;
      const deltaY = droppingPosition.top - this.dragPosition.top;

      this.onDrag(droppingPosition.e, {
        node,
        deltaX,
        deltaY
      });
    }
  }

  getPositionParams(props: Props = this.props): PositionParams {
    return {
      cols: props.cols,
      containerPadding: props.containerPadding,
      containerWidth: props.containerWidth,
      margin: props.margin,
      maxRows: props.maxRows,
      rowHeight: props.rowHeight
    };
  }

  /**
   * This is where we set the grid item's absolute placement. It gets a little tricky because we want to do it
   * well when server rendering, and the only way to do that properly is to use percentage width/left because
   * we don't know exactly what the browser viewport is.
   * Unfortunately, CSS Transforms, which are great for performance, break in this instance because a percentage
   * left is relative to the item itself, not its container! So we cannot use them on the server rendering pass.
   *
   * @param  {Object} pos Position object with width, height, left, top.
   * @return {Object}     Style object.
   */
  createStyle(pos: Position): { [key: string]: ?string } {
    const { usePercentages, containerWidth, useCSSTransforms } = this.props;

    let style;
    // CSS Transforms support (default)
    if (useCSSTransforms) {
      style = setTransform(pos);
    } else {
      // top,left (slow)
      style = setTopLeft(pos);

      // This is used for server rendering.
      if (usePercentages) {
        style.left = perc(pos.left / containerWidth);
        style.width = perc(pos.width / containerWidth);
      }
    }

    return style;
  }

  /**
   * Mix a Draggable instance into a child.
   * @param  {Element} child    Child element.
   * @return {Element}          Child wrapped in Draggable.
   */
  mixinDraggable(
    child: ReactElement<any>,
    isDraggable: boolean
  ): ReactElement<any> {
    return (
      <DraggableCore
        disabled={!isDraggable}
        onStart={this.onDragStart}
        onDrag={this.onDrag}
        onStop={this.onDragStop}
        handle={this.props.handle}
        cancel={
          ".react-resizable-handle" +
          (this.props.cancel ? "," + this.props.cancel : "")
        }
        scale={this.props.transformScale}
        nodeRef={this.elementRef}
      >
        {child}
      </DraggableCore>
    );
  }

  /**
   * Utility function to setup callback handler definitions for
   * similarily structured resize events.
   */
  curryResizeHandler(position: Position, handler: Function): Function {
    return (e: Event, data: ResizeCallbackData): Function =>
      handler(e, data, position);
  }

  /**
   * Mix a Resizable instance into a child.
   * @param  {Element} child    Child element.
   * @param  {Object} position  Position object (pixel values)
   * @return {Element}          Child wrapped in Resizable.
   */
  mixinResizable(
    child: ReactElement<any>,
    position: Position,
    isResizable: boolean
  ): ReactElement<any> {
    const {
      cols,
      minW,
      minH,
      maxW,
      maxH,
      transformScale,
      resizeHandles,
      resizeHandle
    } = this.props;
    const positionParams = this.getPositionParams();

    // This is the max possible width - doesn't go to infinity because of the width of the window
    const maxWidth = calcGridItemPosition(positionParams, 0, 0, cols, 0).width;

    // Calculate min/max constraints using our min & maxes
    const mins = calcGridItemPosition(positionParams, 0, 0, minW, minH);
    const maxes = calcGridItemPosition(positionParams, 0, 0, maxW, maxH);
    const minConstraints = [mins.width, mins.height];
    const maxConstraints = [
      Math.min(maxes.width, maxWidth),
      Math.min(maxes.height, Infinity)
    ];
    return (
      <Resizable
        // These are opts for the resize handle itself
        draggableOpts={{
          disabled: !isResizable
        }}
        className={isResizable ? undefined : "react-resizable-hide"}
        width={position.width}
        height={position.height}
        minConstraints={minConstraints}
        maxConstraints={maxConstraints}
        onResizeStop={this.curryResizeHandler(position, this.onResizeStop)}
        onResizeStart={this.curryResizeHandler(position, this.onResizeStart)}
        onResize={this.curryResizeHandler(position, this.onResize)}
        transformScale={transformScale}
        resizeHandles={resizeHandles}
        handle={resizeHandle}
      >
        {child}
      </Resizable>
    );
  }

  /**
   * onDragStart event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node, delta and position information
   */
  onDragStart: (Event, ReactDraggableCallbackData) => void = (e, { node }) => {
    const { onDragStart, transformScale } = this.props;
    if (!onDragStart) return;

    const newPosition: PartialPosition = { top: 0, left: 0 };

    // TODO: this wont work on nested parents
    const { offsetParent } = node;
    if (!offsetParent) return;
    const parentRect = offsetParent.getBoundingClientRect();
    const clientRect = node.getBoundingClientRect();
    const cLeft = clientRect.left / transformScale;
    const pLeft = parentRect.left / transformScale;
    const cTop = clientRect.top / transformScale;
    const pTop = parentRect.top / transformScale;
    newPosition.left = cLeft - pLeft + offsetParent.scrollLeft;
    newPosition.top = cTop - pTop + offsetParent.scrollTop;
    this.dragPosition = newPosition;
    this.dragging = true;

    // Call callback with this data
    const { x, y } = calcXY(
      this.getPositionParams(),
      newPosition.top,
      newPosition.left,
      this.props.w,
      this.props.h
    );

    return onDragStart.call(this, this.props.i, x, y, {
      e,
      node,
      newPosition
    });
  };

  /**
   * onDrag event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node, delta and position information
   */
  onDrag: (Event, ReactDraggableCallbackData) => void = (
    e,
    { node, deltaX, deltaY }
  ) => {
    const { onDrag } = this.props;
    if (!onDrag) return;

    if (!this.dragging) {
      throw new Error("onDrag called before onDragStart.");
    }
    let top = this.dragPosition.top + deltaY;
    let left = this.dragPosition.left + deltaX;

    const { isBounded, i, w, h, containerWidth } = this.props;
    const positionParams = this.getPositionParams();

    // Boundary calculations; keeps items within the grid
    if (isBounded) {
      const { offsetParent } = node;

      if (offsetParent) {
        const { margin, rowHeight, containerPadding } = this.props;
        const bottomBoundary =
          offsetParent.clientHeight - calcGridItemWHPx(h, rowHeight, margin[1]);
        top = clamp(top - containerPadding[1], 0, bottomBoundary);

        const colWidth = calcGridColWidth(positionParams);
        const rightBoundary =
          containerWidth - calcGridItemWHPx(w, colWidth, margin[0]);
        left = clamp(left - containerPadding[0], 0, rightBoundary);
      }
    }

    const newPosition = (this.dragPosition = { top, left });

    // Call callback with this data
    const { x, y } = calcXY(positionParams, top, left, w, h);
    return onDrag.call(this, i, x, y, {
      e,
      node,
      newPosition
    });
  };

  /**
   * onDragStop event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node, delta and position information
   */
  onDragStop: (Event, ReactDraggableCallbackData) => void = (e, { node }) => {
    const { onDragStop } = this.props;
    if (!onDragStop) return;

    if (!this.dragging) {
      throw new Error("onDragEnd called before onDragStart.");
    }
    const { w, h, i } = this.props;
    const { left, top } = this.dragPosition;
    const newPosition: PartialPosition = { top, left };
    this.dragging = false;
    this.dragPosition = { left: 0, top: 0 };

    const { x, y } = calcXY(this.getPositionParams(), top, left, w, h);

    return onDragStop.call(this, i, x, y, {
      e,
      node,
      newPosition
    });
  };

  /**
   * onResizeStop event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node and size information
   */
  onResizeStop: GridItemResizeCallback = (e, callbackData, position) =>
    this.onResizeHandler(e, callbackData, position, "onResizeStop");

  // onResizeStart event handler
  onResizeStart: GridItemResizeCallback = (e, callbackData, position) =>
    this.onResizeHandler(e, callbackData, position, "onResizeStart");

  // onResize event handler
  onResize: GridItemResizeCallback = (e, callbackData, position) =>
    this.onResizeHandler(e, callbackData, position, "onResize");

  /**
   * Wrapper around resize events to provide more useful data.
   */
  onResizeHandler(
    e: Event,
    { node, size, handle }: ResizeCallbackData, // 'size' is updated position
    position: Position, // existing position
    handlerName: string
  ): void {
    const handler = this.props[handlerName];
    if (!handler) return;
    const { x, y, i, maxH, minH, containerWidth } = this.props;
    const { minW, maxW } = this.props;

    // Clamping of dimensions based on resize direction
    let updatedSize = size;
    if (node) {
      updatedSize = resizeItemInDirection(
        handle,
        position,
        size,
        containerWidth
      );
      this. resizing = handlerName === "onResizeStop" ? null : updatedSize;
    }

    // Get new XY based on pixel size
    let { w, h } = calcWH(
      this.getPositionParams(),
      updatedSize.width,
      updatedSize.height,
      x,
      y,
      handle
    );

    // Min/max capping.
    // minW should be at least 1 (TODO propTypes validation?)
    w = clamp(w, Math.max(minW, 1), maxW);
    h = clamp(h, minH, maxH);

    this.resizePosition = { ...position, ...updatedSize };

    handler.call(this, i, w, h, { e, node, size: updatedSize, handle });
  }

  render(): ReactNode {
    const {
      x,
      y,
      w,
      h,
      isDraggable,
      isResizable,
      droppingPosition,
      useCSSTransforms
    } = this.props;

    const pos = calcGridItemPosition(
      this.getPositionParams(),
      x,
      y,
      w,
      h,
      this.dragging ? this.dragPosition : null,
      this.resizing ? this.resizePosition : null
    );
    const child = React.Children.only(this.props.children);

    // Create the child element. We clone the existing element but modify its className and style.
    let newChild = React.cloneElement(child, {
      ref: this.elementRef,
      className: clsx(
        "react-grid-item",
        child.props.className,
        this.props.className,
        {
          static: this.props.static,
          resizing: Boolean(this.resizing),
          "react-draggable": isDraggable,
          "react-draggable-dragging": Boolean(this.dragging),
          dropping: Boolean(droppingPosition),
          cssTransforms: useCSSTransforms
        }
      ),
      // We can set the width and height on the child, but unfortunately we can't set the position.
      style: {
        ...this.props.style,
        ...child.props.style,
        ...this.createStyle(pos)
      }
    });

    // Resizable support. This is usually on but the user can toggle it off.
    newChild = this.mixinResizable(newChild, pos, isResizable);

    // Draggable support. This is always on, except for with placeholders.
    newChild = this.mixinDraggable(newChild, isDraggable);

    return newChild;
  }
}
