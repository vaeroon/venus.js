<!DOCTYPE html>
<html>
<head>
     <style>
      body {
        font-family: arial, helvetica, sans-serif;
      }
      .t-table{
          display: table;
          font-size: 12px;
          color: #000000;
          border-collapse: collapse;
          margin: 0 auto;
          line-height: 1.5em;
      }
      .t-row{
          display: table-row;
          background-color: #E0FFD7;
      }
      .t-row-fail{
          background-color: #D00;
          color: white;
          font-weight: bold;
          white-space: pre;
      }
      .t-row-header{
          font-weight: bold;
          background-color: #E0E0F0;
      }
      .t-row div{
          display: table-cell;
          border: 1px solid #9999AA;
          padding: 0.5em;
      }
      .t-row .test-message, .t-row .test-name{
          min-width: 200px;
      }
      .stacktrace {
        font-family: courier, monospace;
        font-size: 11px;
      }
     </style>
</head>
<body>
    <div class="t-table">
        <div class="t-row t-row-header">
            <div class="test-name">Name</div>
            <div>Status</div>
            <div class="test-message">Message</div>
            <div>StackTrace</div>
        </div>
         {#.}
            {#tests}
            <div class="t-row {#stackTrace.stack}t-row-fail{/stackTrace.stack}">
               <div>{name}</div>
               <div>{status}</div>
               <div>{message}</div>
               <div class="stacktrace">{stackTrace.stack}</div>
            </div>
            {/tests}
         {/.}
     </div>
</body>
</html>
