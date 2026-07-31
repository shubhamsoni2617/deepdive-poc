import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <pre
          style={{
            padding: "1rem",
            whiteSpace: "pre-wrap",
            background: "#fff",
            color: "#c00",
          }}
        >
          {this.state.error.stack}
        </pre>
      );
    }
    return this.props.children;
  }
}
