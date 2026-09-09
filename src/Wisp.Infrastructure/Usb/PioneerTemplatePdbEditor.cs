using System.Buffers.Binary;
using System.Runtime.InteropServices;

namespace Wisp.Infrastructure.Usb;

/// <summary>
/// Appends rows to an already player-accepted DeviceSQL database. This follows
/// rekordbox's incremental allocation model: it never rebuilds table headers,
/// and turns each table's existing empty-candidate page into a data page only
/// when needed.
/// </summary>
internal sealed class PioneerTemplatePdbEditor
{
    private const int PageSize = 4096;
    private const int PageHeaderSize = 0x28;
    private readonly List<byte> _bytes;

    public PioneerTemplatePdbEditor(byte[] template)
    {
        if (template.Length < PageSize || Read32(template, 4) != PageSize)
            throw new InvalidOperationException("The Pioneer template database is not a valid DeviceSQL PDB.");
        _bytes = template.ToList();
    }

    public int NextId(int tableType, int idOffset)
        => EnumerateRows(tableType).Select(row => (int)Read32(_bytes, row + idOffset)).DefaultIfEmpty(0).Max() + 1;

    /// <summary>
    /// Hides the template's tracks and playlists using DeviceSQL's own
    /// delete-only transaction semantics. Reference tables are left intact:
    /// they do not make a track playable, and preserving them avoids needless
    /// mutations to verified page structures.
    /// </summary>
    public void ClearCatalogueRows()
    {
        var changed = false;
        changed |= ClearRows(0); // tracks
        changed |= ClearRows(7); // playlist tree
        changed |= ClearRows(8); // playlist entries
        if (changed) Write32(20, Read32(_bytes, 20) + 1);
    }

    public void Append(int tableType, byte[] row, int allocation, int? indexShiftOffset = null)
    {
        if (allocation > PageSize - PageHeaderSize - DirectoryBytes(1))
            throw new InvalidOperationException("A Pioneer database row is too large for a DeviceSQL page.");
        var entry = TableOffset(tableType);
        var page = (int)Read32(_bytes, entry + 12);
        if ((_bytes[page * PageSize + 27] & 0x40) != 0)
            page = AllocatePage(tableType);

        var pageOffset = page * PageSize;
        var slots = SlotCount(pageOffset);
        var used = (int)Read16(_bytes, pageOffset + 30);
        if (PageHeaderSize + used + allocation + DirectoryBytes(slots + 1) > PageSize)
        {
            page = AllocatePage(tableType);
            pageOffset = page * PageSize;
            slots = 0;
            used = 0;
        }

        var group = slots / 16;
        var bit = slots % 16;
        var groupBase = pageOffset + PageSize - group * 0x24;
        if (bit == 0)
        {
            Write16(groupBase - 4, 0);
            Write16(groupBase - 2, 0);
        }

        Ensure(pageOffset + PageSize);
        row.CopyTo(CollectionsMarshal.AsSpan(_bytes).Slice(pageOffset + PageHeaderSize + used));
        CollectionsMarshal.AsSpan(_bytes).Slice(pageOffset + PageHeaderSize + used + row.Length, allocation - row.Length).Clear();
        if (indexShiftOffset is not null) Write16(pageOffset + PageHeaderSize + used + indexShiftOffset.Value, (ushort)(0x20 * slots));

        Write16(groupBase - 6 - 2 * bit, (ushort)used);
        Write16(groupBase - 4, (ushort)(Read16(_bytes, groupBase - 4) | (1 << bit)));
        Write16(groupBase - 2, (ushort)(Read16(_bytes, groupBase - 2) | (1 << bit)));

        var newSlots = slots + 1;
        _bytes[pageOffset + 24] = (byte)newSlots;
        Write16(pageOffset + 25, (ushort)(0x20 * PresentCount(pageOffset, newSlots) | (newSlots > 255 ? 1 : 0)));
        used += allocation;
        Write16(pageOffset + 28, (ushort)(PageSize - PageHeaderSize - used - DirectoryBytes(newSlots)));
        Write16(pageOffset + 30, (ushort)used);
        Write16(pageOffset + 32, 1);
        Write16(pageOffset + 34, (ushort)slots);
        Write32(pageOffset + 16, Read32(_bytes, 20) + 1);
        Write32(20, Read32(_bytes, 20) + 1);
    }

    public byte[] ToArray() => _bytes.ToArray();

    private int AllocatePage(int tableType)
    {
        var entry = TableOffset(tableType);
        var page = (int)Read32(_bytes, entry + 4);
        var nextUnused = (int)Read32(_bytes, 12);
        Ensure((page + 1) * PageSize);
        CollectionsMarshal.AsSpan(_bytes).Slice(page * PageSize, PageSize).Clear();
        Write32(page * PageSize + 4, (uint)page);
        Write32(page * PageSize + 8, (uint)tableType);
        Write32(page * PageSize + 12, (uint)nextUnused);
        _bytes[page * PageSize + 27] = 0x24;
        Write16(page * PageSize + 28, PageSize - PageHeaderSize);

        var oldLast = (int)Read32(_bytes, entry + 12);
        if ((_bytes[oldLast * PageSize + 27] & 0x40) != 0 && Read32(_bytes, oldLast * PageSize + 44) == 0x03ffffff)
            Write32(oldLast * PageSize + 44, (uint)page);
        Write32(entry + 12, (uint)page);
        Write32(entry + 4, (uint)nextUnused);
        Write32(12, (uint)(nextUnused + 1));
        return page;
    }

    private bool ClearRows(int type)
    {
        var entry = TableOffset(type);
        var page = (int)Read32(_bytes, entry + 8);
        var last = (int)Read32(_bytes, entry + 12);
        var generation = 0u;
        var scan = page;
        while (true)
        {
            generation = Math.Max(generation, Read32(_bytes, scan * PageSize + 16));
            if (scan == last) break;
            scan = (int)Read32(_bytes, scan * PageSize + 12);
        }
        generation++;
        var changed = false;
        while (true)
        {
            var offset = page * PageSize;
            var next = (int)Read32(_bytes, offset + 12);
            if ((_bytes[offset + 27] & 0x40) == 0)
            {
                // DeviceSQL represents deletion exclusively through each
                // row group's presence bitmap. Keep the row count, heap
                // length, free-space accounting and transaction masks byte
                // exact: older CDJs validate those page-level values even
                // when no rows are present. A missing presence bit makes the
                // old row unreachable without changing the accepted page
                // topology.
                var slots = SlotCount(offset);
                if (slots > 0)
                {
                    for (var group = 0; group < (slots + 15) / 16; group++)
                    {
                        var groupBase = offset + PageSize - group * 0x24;
                        Write16(groupBase - 4, 0); // deleted: no live rows
                        Write16(groupBase - 2, 0); // no appended rows in this save
                    }
                    _bytes[offset + 27] |= 0x10; // data page with deletions
                    Write16(offset + 25, (ushort)(slots > 255 ? 1 : 0)); // zero live rows, retain overflow bit
                    Write16(offset + 32, 0x1fff); // delete-only save sentinel
                    Write16(offset + 34, 0x1fff); // delete-only save sentinel
                    Write32(offset + 16, generation);
                    changed = true;
                }
            }
            if (page == last) return changed;
            page = next;
        }
    }

    private IEnumerable<int> EnumerateRows(int type)
    {
        var entry = TableOffset(type);
        var page = (int)Read32(_bytes, entry + 8);
        var last = (int)Read32(_bytes, entry + 12);
        while (true)
        {
            var offset = page * PageSize;
            if ((_bytes[offset + 27] & 0x40) == 0)
            {
                var slots = SlotCount(offset);
                for (var slot = 0; slot < slots; slot++)
                {
                    var groupBase = offset + PageSize - slot / 16 * 0x24;
                    if ((Read16(_bytes, groupBase - 4) & (1 << (slot % 16))) == 0) continue;
                    yield return offset + PageHeaderSize + Read16(_bytes, groupBase - 6 - 2 * (slot % 16));
                }
            }
            if (page == last) yield break;
            page = (int)Read32(_bytes, offset + 12);
        }
    }

    private int TableOffset(int type)
    {
        var tables = (int)Read32(_bytes, 8);
        for (var i = 0; i < tables; i++)
        {
            var offset = 0x1c + i * 16;
            if (Read32(_bytes, offset) == type) return offset;
        }
        throw new InvalidOperationException($"Pioneer template has no table {type}.");
    }

    private int SlotCount(int pageOffset) => _bytes[pageOffset + 24] + 0x100 * (_bytes[pageOffset + 25] & 1);
    private int PresentCount(int pageOffset, int slots) => Enumerable.Range(0, slots).Count(slot => (Read16(_bytes, pageOffset + PageSize - slot / 16 * 0x24 - 4) & (1 << (slot % 16))) != 0);
    private static int DirectoryBytes(int slots) => slots == 0 ? 0 : 2 * slots + 4 * ((slots + 15) / 16);
    private void Ensure(int length) { while (_bytes.Count < length) _bytes.Add(0); }
    private static ushort Read16(IReadOnlyList<byte> data, int offset)
        => data is List<byte> list
            ? BinaryPrimitives.ReadUInt16LittleEndian(CollectionsMarshal.AsSpan(list).Slice(offset, 2))
            : BinaryPrimitives.ReadUInt16LittleEndian(data.Skip(offset).Take(2).ToArray());
    private static uint Read32(IReadOnlyList<byte> data, int offset)
        => data is List<byte> list
            ? BinaryPrimitives.ReadUInt32LittleEndian(CollectionsMarshal.AsSpan(list).Slice(offset, 4))
            : BinaryPrimitives.ReadUInt32LittleEndian(data.Skip(offset).Take(4).ToArray());
    private void Write16(int offset, int value) => BinaryPrimitives.WriteUInt16LittleEndian(CollectionsMarshal.AsSpan(_bytes).Slice(offset, 2), (ushort)value);
    private void Write16(int offset, ushort value) => BinaryPrimitives.WriteUInt16LittleEndian(CollectionsMarshal.AsSpan(_bytes).Slice(offset, 2), value);
    private void Write32(int offset, uint value) => BinaryPrimitives.WriteUInt32LittleEndian(CollectionsMarshal.AsSpan(_bytes).Slice(offset, 4), value);
}
