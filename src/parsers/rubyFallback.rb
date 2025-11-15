#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'ripper'

source = STDIN.read

# Safely converts Ripper nodes into Ruby primitives.
def literal(node)
  return nil unless node.is_a?(Array)

  type = node[0]
  case type
  when :string_literal
    literal(node[1])
  when :string_content
    parts = node[1..] || []
    parts.map { |part| literal(part) }.join
  when :string_add
    [literal(node[1]), literal(node[2])].join
  when :@tstring_content, :@ident, :@const
    node[1]
  when :symbol_literal
    literal(node[1])
  when :symbol
    literal(node[1])
  when :dyna_symbol
    literal(node[1])
  when :@label
    node[1].to_s.delete_suffix(':')
  when :var_ref, :vcall
    literal(node[1])
  when :@kw
    case node[1]
    when 'true' then true
    when 'false' then false
    when 'nil' then nil
    else node[1]
    end
  when :@int
    node[1].to_i
  when :@float
    node[1].to_f
  when :array
    elements = node[1] || []
    elements.map { |element| literal(element) }.compact
  when :args_add_block
    args = node[1] || []
    args.map { |element| literal(element) }
  when :paren
    literal(node[1])
  when :arg_paren
    literal(node[1])
  when :bare_assoc_hash
    parse_options(node)
  when :hash
    parse_options(node[1])
  when :assoc_new
    key = literal(node[1])
    value = literal(node[2])
    [key, value]
  else
    nil
  end
end

def parse_options(node)
  return {} unless node.is_a?(Array)

  case node[0]
  when :bare_assoc_hash
    pairs = node[1] || []
    pairs.each_with_object({}) do |assoc, hash|
      next unless assoc.is_a?(Array) && assoc[0] == :assoc_new

      key = literal(assoc[1])
      key = key.to_s if key
      value = literal(assoc[2])
      hash[key] = value
    end
  when :hash
    parse_options(node[1])
  else
    {}
  end
end

def extract_args(node)
  return [] unless node.is_a?(Array)

  case node[0]
  when :args_add_block
    node[1] || []
  when :arg_paren
    extract_args(node[1])
  when :paren
    extract_args(node[1])
  else
    [node]
  end
end

def append_timestamps(columns)
  columns << { 'name' => 'created_at', 'type' => 'datetime', 'options' => { 'null' => false } }
  columns << { 'name' => 'updated_at', 'type' => 'datetime', 'options' => { 'null' => false } }
end

def process_column(columns, method_name, args_nodes)
  if method_name == 'timestamps'
    append_timestamps(columns)
    return
  end

  return if args_nodes.nil? || args_nodes.empty?

  raw_name = literal(args_nodes[0])
  column_name = raw_name.to_s if raw_name
  return if column_name.nil? || column_name.empty?

  options = {}
  args_nodes[1..]&.each do |arg_node|
    options.merge!(parse_options(arg_node))
  end

  columns << {
    'name' => column_name,
    'type' => method_name,
    'options' => options
  }
end

begin
  sexp = Ripper.sexp(source)

  if sexp.nil?
    raise StandardError, 'Ripper で AST を生成できませんでした'
  end

  tables = []
  enums = []

  stack = [sexp]
  until stack.empty?
    node = stack.pop
    next unless node.is_a?(Array)

    case node[0]
    when :method_add_block
      command = node[1]
      block = node[2]
      if command.is_a?(Array) && command[0] == :command
        method_token = command[1]
        method_name = literal(method_token)

        if method_name == 'create_table'
          args_nodes = extract_args(command[2])
          table_identifier = args_nodes && args_nodes[0]
          table_name_value = literal(table_identifier)
          table_name = table_name_value.to_s if table_name_value

          if table_name && !table_name.empty?
            columns = []
            if block.is_a?(Array) && block[0] == :do_block
              bodystmt = block[2]
              statements = bodystmt&.[](1) || []
              statements.each do |statement|
                next unless statement.is_a?(Array)

                case statement[0]
                when :command_call
                  receiver = statement[1]
                  next unless receiver.is_a?(Array)
                  method_token = statement[3]
                  method_name = literal(method_token)
                  args_nodes = extract_args(statement[4])
                  process_column(columns, method_name, args_nodes)
                when :call
                  method_token = statement[3]
                  method_name = literal(method_token)
                  process_column(columns, method_name, [])
                when :method_add_arg
                  call = statement[1]
                  args = statement[2]
                  next unless call.is_a?(Array) && call[0] == :call

                  method_token = call[3]
                  method_name = literal(method_token)
                  args_nodes = extract_args(args)
                  process_column(columns, method_name, args_nodes)
                end
              end
            end

            tables << {
              'name' => table_name,
              'columns' => columns
            }
          end
        end
      end
    when :command
      method_name = literal(node[1])
      if method_name == 'create_enum'
        args_nodes = extract_args(node[2])
        if args_nodes && !args_nodes.empty?
          enum_name_value = literal(args_nodes[0])
          enum_name = enum_name_value.to_s if enum_name_value

          if enum_name && !enum_name.empty?
            values_node = args_nodes[1]
            values = literal(values_node)
            values = Array(values).compact.map(&:to_s)

            enums << {
              'name' => enum_name,
              'values' => values
            }
          end
        end
      end
    end

    node.each do |child|
      stack << child if child.is_a?(Array)
    end
  end

  output = {
    'tables' => tables,
    'enums' => enums,
    'errors' => [],
    'warnings' => []
  }

  puts JSON.generate(output)
rescue StandardError => e
  warn(e.full_message)
  error_output = {
    'tables' => [],
    'enums' => [],
    'errors' => [e.message],
    'warnings' => []
  }
  puts JSON.generate(error_output)
  exit 1
end
